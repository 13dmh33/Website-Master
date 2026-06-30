#!/usr/bin/env node
'use strict';
/**
 * Reply Agent — gap-selling email drafting for inbound replies
 *
 * Polls Zoho IMAP for replies to email campaigns, classifies intent,
 * detects personality type, and drafts one decisive gap-selling reply
 * per message into a local review queue. Dave sends every email himself.
 * autoSend is OFF — see CHECKPOINT.md §Graduation for the two-phase path.
 *
 * Usage:
 *   node scripts/reply-agent.js              # poll + draft + notify
 *   node scripts/reply-agent.js --dry-run    # preview; no API calls, no writes
 *   node scripts/reply-agent.js --show-drafts # list pending drafts and exit
 *
 * Cron (hourly, 4am–7pm MST, Mac):
 *   0 4-19 * * * cd /path/to/Website-Master && /usr/local/bin/node scripts/reply-agent.js >> logs/reply-agent.log 2>&1
 *
 * Reads:  queue/*-brief.json  messages/*-sent.json  .env.local
 *         config/reply-agent-config.json  config/reply-agent-state.json
 * Writes: messages/reply-drafts-queue.json
 *         messages/*-sent.json  (reply_thread field only — additive)
 *         config/reply-agent-config.json (spend tracking)
 *         config/reply-agent-state.json  (processed IDs, digest timestamp)
 *         Google Sheet SentLog tab  (status + notes, update-in-place)
 *         logs/reply-agent-{date}.log
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT          = path.join(__dirname, '..');
const CONFIG_PATH   = path.join(ROOT, 'config', 'reply-agent-config.json');
const RA_STATE_PATH = path.join(ROOT, 'config', 'reply-agent-state.json');
const DRAFTS_PATH   = path.join(ROOT, 'messages', 'reply-drafts-queue.json');
const QUEUE_DIR     = path.join(ROOT, 'queue');
const MESSAGES_DIR  = path.join(ROOT, 'messages');
const LOGS_DIR      = path.join(ROOT, 'logs');

// Google Sheets constants (auth helpers duplicated from sheet-log.js —
// extract to lib/sheets-auth.js in a future refactor per spec)
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';
const SHEET_TAB   = process.env.SHEET_TAB || 'SentLog';

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const SHOW_DRAFTS = args.includes('--show-drafts');

// Sheet column indices — must match sheet-log.js HEADER (v3, 16-col A–P)
const COL = {
  company: 0, email: 1, trade: 2, lastSend: 3, dateUpdated: 4,
  status: 5, demoUrl: 6, email1: 7, email2: 8, email3: 9, email4: 10,
  lastReplyDate: 11, replySummary: 12, unsubscribed: 13, unsubDate: 14, notes: 15,
};

// Only upgrade status; never downgrade these
const PROTECTED_STATUSES = new Set(['customer', 'do not contact']);
const STATUS_RANK = { sent: 1, replied: 2, quoted: 3, customer: 4 };

// Intents that get an immediate hot-alert (break out of batched digest)
const HOT_INTENTS = new Set(['positive']);

// ── CONFIG ─────────────────────────────────────────────────────────────────────

function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}
function today() { return new Date().toISOString().split('T')[0]; }

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      enabled:        true,
      autoSend:       false,       // NEVER enable in this version — see CHECKPOINT.md
      digestMode:     'batched',   // 'batched' (once/day) | 'per_reply'
      model:          'claude-haiku-4-5-20251001',
      costCapMonthly: 5.00,
      currentMonth:   currentMonth(),
      spentThisMonth: 0.00,
      rates: {
        input_per_mtok:       0.80,
        output_per_mtok:      4.00,
        cache_write_per_mtok: 1.00,
        cache_read_per_mtok:  0.08,
      },
      // Gap economics — fill these for concrete cost framing in drafts.
      // If null, Claude uses qualitative language (still effective; numbers are better).
      avgJobValue:  null,   // number: average revenue per job (e.g. 350)
      missRatePct:  null,   // number: estimated % of calls missed (e.g. 30)
      proofPoint:   null,   // string: one real before/after or recovered-job line
      bookingLink:  process.env.CALCOM_LINK || 'https://cal.com/david-hettinger-g8qbdk/30min',
      fromName:     'Dave',
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  if (!DRY_RUN) fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function loadRAState() {
  if (!fs.existsSync(RA_STATE_PATH)) {
    return { processedMessageIds: [], lastDigestSentAt: null, lastRunAt: null };
  }
  return JSON.parse(fs.readFileSync(RA_STATE_PATH, 'utf8'));
}

function saveRAState(st) {
  if (!DRY_RUN) fs.writeFileSync(RA_STATE_PATH, JSON.stringify(st, null, 2));
}

function loadDrafts() {
  if (!fs.existsSync(DRAFTS_PATH)) return { drafts: [] };
  return JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8'));
}

function saveDrafts(q) {
  if (!DRY_RUN) fs.writeFileSync(DRAFTS_PATH, JSON.stringify(q, null, 2));
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!DRY_RUN) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOGS_DIR, `reply-agent-${ts.split('T')[0]}.log`),
      line + '\n'
    );
  }
}

function normalizeEmail(s) { return (s || '').toLowerCase().trim(); }

function buildEmailIndex() {
  const index = new Map();
  if (!fs.existsSync(QUEUE_DIR)) return index;
  for (const file of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
    try {
      const brief  = readJsonSafe(path.join(QUEUE_DIR, file));
      if (!brief?.email) continue;
      const leadId = file.replace('-brief.json', '');
      index.set(normalizeEmail(brief.email), { brief, leadId });
    } catch { /* skip */ }
  }
  return index;
}

function calcCost(usage, rates) {
  return (usage.input_tokens                || 0) / 1_000_000 * rates.input_per_mtok
       + (usage.output_tokens               || 0) / 1_000_000 * rates.output_per_mtok
       + (usage.cache_creation_input_tokens || 0) / 1_000_000 * rates.cache_write_per_mtok
       + (usage.cache_read_input_tokens     || 0) / 1_000_000 * rates.cache_read_per_mtok;
}

// Remove quoted lines and Outlook-style quote headers from reply body
function stripQuoted(text) {
  return text.split('\n')
    .filter(l => {
      const t = l.trim();
      return !t.startsWith('>') && !/^On .{0,120}wrote:$/.test(t);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── COST GUARD ──────────────────────────────────────────────────────────────

function checkCap(cfg) {
  if (cfg.currentMonth !== currentMonth()) {
    cfg.currentMonth   = currentMonth();
    cfg.spentThisMonth = 0;
  }
  if (cfg.spentThisMonth >= cfg.costCapMonthly) {
    log(`COST CAP: $${cfg.spentThisMonth.toFixed(4)} / $${cfg.costCapMonthly.toFixed(2)} — drafting paused for the month.`);
    return false;
  }
  return true;
}

function recordCost(cfg, cost, usage) {
  cfg.spentThisMonth = parseFloat((cfg.spentThisMonth + cost).toFixed(6));
  saveConfig(cfg);
  try {
    const { recordAnthropic } = require('./cost-tracker');
    recordAnthropic(cost, 'reply_agent', usage);
  } catch { /* cost-tracker is optional here */ }
}

// ── THREAD STATE ─────────────────────────────────────────────────────────────

function loadThread(leadId) {
  const sent = readJsonSafe(path.join(MESSAGES_DIR, `${leadId}-sent.json`));
  return sent?.reply_thread || [];
}

function appendToThread(leadId, entry) {
  if (DRY_RUN) return;
  const sentPath = path.join(MESSAGES_DIR, `${leadId}-sent.json`);
  const sent = readJsonSafe(sentPath) || {};
  if (!Array.isArray(sent.reply_thread)) sent.reply_thread = [];
  sent.reply_thread.push(entry);
  fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));
}

// ── IMAP POLLING ─────────────────────────────────────────────────────────────

async function pollReplies(raState, emailIndex) {
  let ImapFlow;
  try { ({ ImapFlow } = require('imapflow')); } catch {
    log('✗ imapflow not installed — run: npm install imapflow');
    return [];
  }

  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) { log('ZOHO_EMAIL / ZOHO_APP_PASSWORD not set.'); return []; }

  const ourEmail  = normalizeEmail(user);
  const processed = new Set(raState.processedMessageIds || []);

  // Look back 7 days; dedup via processedMessageIds handles re-fetches safely
  const lookback = new Date();
  lookback.setDate(lookback.getDate() - 7);

  const client = new ImapFlow({
    host: 'imap.zoho.com', port: 993, secure: true,
    auth: { user, pass }, logger: false,
  });

  await client.connect();
  const replies = [];

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ since: lookback });
      log(`IMAP: ${uids.length} message(s) in 7-day window`);

      if (uids.length > 0) {
        for await (const msg of client.fetch(uids, {
          uid:        true,
          envelope:   true,
          headers:    ['auto-submitted', 'x-autoreply', 'x-autorespond'],
          bodyParts:  ['TEXT', '1'],
        })) {
          const messageId = msg.envelope?.messageId || String(msg.uid);

          // Dedup layer 1: processed IDs set
          if (processed.has(messageId)) continue;
          processed.add(messageId);

          const fromAddr = msg.envelope?.from?.[0]?.address || '';
          const fromNorm = normalizeEmail(fromAddr);
          const subject  = msg.envelope?.subject || '';
          const hdrs     = msg.headers;

          // Skip our own email (reflected or Zoho quirks)
          if (fromNorm === ourEmail) continue;

          // Skip auto-replies via headers
          const autoSub = normalizeEmail(hdrs?.get?.('auto-submitted') || '');
          if ((autoSub && autoSub !== 'no') || hdrs?.get?.('x-autoreply') || hdrs?.get?.('x-autorespond')) continue;

          // Skip auto-reply subject patterns
          const subjLc = subject.toLowerCase();
          if (['out of office', 'auto-reply', 'automatic reply', 'autoreply',
               'auto response', 'automated response', 'on vacation'].some(kw => subjLc.includes(kw))) continue;

          // Match to a known lead
          const lead = emailIndex.get(fromNorm);
          if (!lead) { log(`No lead match for ${fromAddr}`); continue; }

          // Extract body text
          const bodyBuf = msg.bodyParts?.get('TEXT') || msg.bodyParts?.get('1');
          const rawBody = bodyBuf ? Buffer.from(bodyBuf).toString('utf8') : '';
          const bodyText = stripQuoted(rawBody).slice(0, 1500).trim();

          replies.push({
            messageId,
            fromAddr,
            fromNorm,
            subject,
            bodyText,
            inReplyTo:   msg.envelope?.inReplyTo || '',
            receivedAt:  msg.envelope?.date?.toISOString() || new Date().toISOString(),
            lead,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  // Persist updated processed IDs immediately (cap at 2000)
  raState.processedMessageIds = [...processed].slice(-2000);

  log(`IMAP: ${replies.length} new reply(ies) to process`);
  return replies;
}

// ── CLAUDE PROMPT ─────────────────────────────────────────────────────────────

function buildSystemPrompt(cfg) {
  const hasEcon = cfg.avgJobValue || cfg.missRatePct;
  const econBlock = hasEcon
    ? `Gap economics (use these numbers when framing cost):
- Average job value: $${cfg.avgJobValue}
- Estimated missed-call rate: ${cfg.missRatePct}% of inbound calls go unanswered
- Proof point: ${cfg.proofPoint || '(not set — omit specific claim)'}
Use these to make the cost of inaction concrete. If a value is null, use qualitative language.`
    : `Gap economics: NOT SET. Use qualitative language only. Never fabricate numbers. Never cite a specific job value or call-loss percentage.`;

  return `You are a gap-selling email strategist for Trevo Advisors — a web and AI agency serving home service contractors (plumbers, electricians, handymen, roofers).

Your task: given a contractor's reply to a cold outreach email, draft ONE decisive email reply that earns a 30-minute diagnostic call. You are NOT pitching a product. You are acting like a consultant who wants to understand their situation before offering anything.

${econBlock}

PERSONALITY TYPES — adjust TONE and DELIVERY only; gap substance is constant:
- assertive: Direct, confident. Lead with a number or concrete benefit. Short sentences. Drop the booking link early.
- amiable: Warm, rapport-first. Name the low-risk offer. Paint a brief vision. Build trust before asking for anything.
- expressive: Enthusiastic but not pushy. One real proof point or social signal. Relationship tone.
- analytic: Patient, specific, evidence-based. No grand claims. Invite a precise diagnostic question. Let them lead.

IMPORTANT — typing confidence:
Most contractor replies are 1-2 sentences. A thin reply gives LOW type confidence. If the reply doesn't clearly reveal personality, set typeConfidence to "low" and default to neutral-professional delivery. A neutral draft must work regardless of type.

GAP-SELLING RULES FOR THE DRAFT (non-negotiable):
1. Name their CURRENT STATE in contractor language: missed calls while on a job, no/outdated website, leads going cold after hours, losing jobs to whoever picks up the phone.
2. Imply the COST concretely: a missed call = a booked job that went to a competitor. Use the gap economics numbers above if set; qualitative only if not.
3. Briefly point at the FUTURE STATE: every call answered, every lead captured, a site that works even at 11pm.
4. Frame the call as DIAGNOSIS: "let's look at how many calls you're actually losing" — NOT "let me show you our product."
5. ONE sharp diagnostic question maximum. Doctor mode: ask before prescribing.
6. FORBIDDEN: Nora feature lists, product capability dumps, "revolutionary", "seamlessly", "innovative solution", you-focused copy, unprovable claims, AI clichés, spammy openers ("I noticed your business...", "I'd love to help you grow...").

Booking link: ${cfg.bookingLink}
Sender name: ${cfg.fromName || 'Dave'}

OUTPUT FORMAT: respond with ONLY a valid JSON object. No markdown, no preamble, no explanation.
{
  "type": "assertive|amiable|expressive|analytic",
  "typeConfidence": "high|low",
  "gapRead": "one sentence describing their likely current state and core pain",
  "draftSubject": "Re: [concise subject]",
  "draftBody": "the complete email body — plain text, no HTML"
}`;
}

function buildUserPrompt(brief, reply, thread, intent, intentConfidence) {
  const cityDisplay = (brief.city || '').replace(/,\s*[A-Z]{2}$/, '');
  const reviewLine  = brief.review_count
    ? `${brief.review_count} Google reviews${brief.rating ? ` (${brief.rating}★)` : ''}`
    : 'review count unknown';

  const threadCtx = thread.length > 0
    ? `\nPRIOR THREAD (${thread.length} exchange${thread.length > 1 ? 's' : ''}):\n` +
      thread.slice(-3).map(t =>
        `  Their reply (${t.intent}): "${t.bodySnippet}"\n  Our draft: "${t.agentDraftSnippet || '(no draft recorded)'}"`
      ).join('\n')
    : '';

  return `PROSPECT:
Company:    ${brief.business_name || '(unknown)'}
Trade:      ${brief.trade || 'contractor'}
City:       ${cityDisplay}
Reviews:    ${reviewLine}
Hero angle: ${brief.hero_angle || '(none from diagnosis)'}

THEIR REPLY TO OUR CAMPAIGN EMAIL:
Subject: ${reply.subject}
Body: ${reply.bodyText || '(empty — classify from subject only)'}

KEYWORD CLASSIFICATION (free, pre-computed):
Intent: ${intent} | Confidence: ${intentConfidence}
${threadCtx}

Draft the gap-selling reply. Follow all system prompt rules exactly.`;
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function generateDraft(claudeClient, cfg, brief, reply, thread, intent, intentConfidence) {
  const response = await claudeClient.messages.create({
    model:      cfg.model,
    max_tokens: 650,
    system: [{ type: 'text', text: buildSystemPrompt(cfg), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserPrompt(brief, reply, thread, intent, intentConfidence) }],
  });

  const raw    = response.content[0]?.text?.trim() || '';
  const parsed = extractJson(raw);

  if (!parsed?.draftBody) {
    log(`WARN: Claude returned invalid JSON — raw snippet: ${raw.slice(0, 150)}`);
    return null;
  }

  return { ...parsed, usage: response.usage };
}

// ── GOOGLE SHEET UPDATE ────────────────────────────────────────────────────────
// Auth helpers below are intentionally duplicated from sheet-log.js.
// They should be extracted to lib/sheets-auth.js when sheet-log.js is refactored.

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath || !fs.existsSync(credPath)) return null;
  return readJsonSafe(credPath);
}

async function getGoogleToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const hdr  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const clm  = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const si   = `${hdr}.${clm}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(si); signer.end();
  const assertion = `${si}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Google token failed (HTTP ${res.status})`);
  const json = await res.json();
  if (!json.access_token) throw new Error('No access_token in Google response');
  return json.access_token;
}

function quoteTab(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

async function sheetsGetAllRows(token, sheetId) {
  const range = `${quoteTab(SHEET_TAB)}!A1:P`;
  const res   = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return (await res.json()).values || [];
}

async function sheetsBatchUpdate(token, sheetId, data) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values:batchUpdate`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!res.ok) throw new Error(`batchUpdate failed (HTTP ${res.status})`);
  return res.json();
}

async function sheetsAppendRow(token, sheetId, row) {
  const range = `${quoteTab(SHEET_TAB)}!A1`;
  const url   = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res   = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`append failed (HTTP ${res.status})`);
  return res.json();
}

/**
 * Update Sheet for an inbound reply event:
 * - Sets status (respecting hierarchy and protected states)
 * - Appends a terse timestamped note to column P
 * - Updates last reply date and reply summary
 * - Sets unsubscribed flag if opt-out
 * - Creates a new row if this lead isn't in the Sheet yet
 */
async function updateSheetForReply(email, brief, newStatus, noteText, replyDate, replySummary, isUnsub) {
  if (DRY_RUN) {
    log(`[dry-run] Sheet: ${email} → status=${newStatus} note="${noteText}"`);
    return;
  }

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) { log('SHEET_ID not set — skipping Sheet update'); return; }

  const sa = loadServiceAccount();
  if (!sa) { log('No Google service account — skipping Sheet update'); return; }

  let token;
  try { token = await getGoogleToken(sa); }
  catch (e) { log(`Sheet auth failed: ${e.message}`); return; }

  const existing  = await sheetsGetAllRows(token, sheetId);
  const headerRow = existing[0] || [];

  // Locate email column by name (handles old 8-col and new 16-col schemas)
  const emailColIdx = headerRow.indexOf('email') !== -1 ? headerRow.indexOf('email') : COL.email;

  // Find row by email (linear scan; small sheet)
  let rowIdx = -1;
  for (let i = 1; i < existing.length; i++) {
    if (normalizeEmail(existing[i][emailColIdx] || '') === normalizeEmail(email)) {
      rowIdx = i; break;
    }
  }

  const todayStr    = today();
  const existingRow = rowIdx >= 0 ? existing[rowIdx] : null;

  // Preserve user-editable status — only upgrade, never downgrade
  const existingStatus = existingRow?.[COL.status] || 'sent';
  const existingNotes  = existingRow?.[COL.notes]  || '';

  let finalStatus = newStatus;
  if (PROTECTED_STATUSES.has(existingStatus)) {
    finalStatus = existingStatus;
  } else if (newStatus !== 'do not contact') {
    const existingRank = STATUS_RANK[existingStatus] || 1;
    const newRank      = STATUS_RANK[newStatus]      || 1;
    if (newRank <= existingRank) finalStatus = existingStatus;
  }

  // Append note (additive — never erase prior notes)
  const finalNotes = existingNotes
    ? `${existingNotes}\n${todayStr} ${noteText}`
    : `${todayStr} ${noteText}`;

  try {
    if (rowIdx >= 0) {
      const sheetRow = rowIdx + 1;
      const updates  = [
        { range: `${quoteTab(SHEET_TAB)}!E${sheetRow}`, values: [[todayStr]]      }, // date updated
        { range: `${quoteTab(SHEET_TAB)}!F${sheetRow}`, values: [[finalStatus]]   }, // status
        { range: `${quoteTab(SHEET_TAB)}!L${sheetRow}`, values: [[replyDate]]     }, // last reply date
        { range: `${quoteTab(SHEET_TAB)}!M${sheetRow}`, values: [[replySummary]]  }, // reply summary
        { range: `${quoteTab(SHEET_TAB)}!P${sheetRow}`, values: [[finalNotes]]    }, // notes
      ];
      if (isUnsub) {
        updates.push({ range: `${quoteTab(SHEET_TAB)}!N${sheetRow}`, values: [['TRUE']]     });
        updates.push({ range: `${quoteTab(SHEET_TAB)}!O${sheetRow}`, values: [[replyDate]]  });
      }
      await sheetsBatchUpdate(token, sheetId, updates);
    } else {
      // Row not found — create it (reply arrived before sheet-log.js ran)
      const row       = Array(16).fill('');
      row[COL.company]       = brief?.business_name || email;
      row[COL.email]         = email;
      row[COL.trade]         = brief?.trade  || '';
      row[COL.dateUpdated]   = todayStr;
      row[COL.status]        = finalStatus;
      row[COL.demoUrl]       = brief?.demo_url || '';
      row[COL.lastReplyDate] = replyDate;
      row[COL.replySummary]  = replySummary;
      row[COL.unsubscribed]  = isUnsub ? 'TRUE' : 'FALSE';
      row[COL.unsubDate]     = isUnsub ? replyDate : '';
      row[COL.notes]         = finalNotes;
      await sheetsAppendRow(token, sheetId, row);
    }
    log(`Sheet updated — ${email}: status=${finalStatus}`);
  } catch (e) {
    log(`WARN: Sheet update failed for ${email}: ${e.message}`);
  }
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

function makeTransport() {
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) throw new Error('ZOHO_EMAIL / ZOHO_APP_PASSWORD not set');
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({ host: 'smtp.zoho.com', port: 465, secure: true, auth: { user, pass } });
}

function formatDraftBlock(d) {
  return [
    '━'.repeat(56),
    `Company:  ${d.company}  (${d.trade}, ${d.city})`,
    `Email:    ${d.email}`,
    `Intent:   ${d.intent} (${d.intentConfidence} confidence)`,
    `Type:     ${d.personalityType} (${d.personalityConfidence} confidence)`,
    `Gap read: ${d.gapRead}`,
    ``,
    `─── DRAFT ───`,
    `Subject: ${d.draftSubject}`,
    ``,
    d.draftBody,
    '━'.repeat(56),
  ].join('\n');
}

async function sendDigest(pendingDrafts, cfg) {
  if (DRY_RUN || pendingDrafts.length === 0) return;
  const user = process.env.ZOHO_EMAIL;
  const to   = process.env.REPORT_TO_EMAIL || user;
  if (!user || !to) { log('WARN: cannot send digest — ZOHO_EMAIL not set'); return; }

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject   = `Reply Agent — ${pendingDrafts.length} draft${pendingDrafts.length > 1 ? 's' : ''} ready — ${dateLabel}`;

  const body = [
    `Reply Agent Digest — ${dateLabel}`,
    ``,
    `${pendingDrafts.length} draft reply${pendingDrafts.length > 1 ? 's' : ''} ready for your review.`,
    `For each draft: read it, copy the body into Zoho as a reply, and send it yourself.`,
    `After sending, update the Sheet status (column F) if the conversation has progressed.`,
    ``,
    ...pendingDrafts.map(formatDraftBlock),
    ``,
    `─── Cost ───`,
    `Reply Agent MTD: $${cfg.spentThisMonth.toFixed(4)} / $${cfg.costCapMonthly.toFixed(2)} cap`,
    `Queue file: messages/reply-drafts-queue.json`,
    `To view from terminal: node scripts/reply-agent.js --show-drafts`,
  ].join('\n');

  try {
    await makeTransport().sendMail({
      from:    `"Trevo Reply Agent" <${user}>`,
      to,
      subject,
      text:    body,
    });
    log(`Digest sent to ${to} (${pendingDrafts.length} draft${pendingDrafts.length > 1 ? 's' : ''})`);
  } catch (e) {
    log(`WARN: digest send failed — ${e.message}`);
  }
}

async function sendHotAlert(draft, cfg) {
  if (DRY_RUN) { log(`[dry-run] HOT ALERT would fire for ${draft.company}`); return; }
  const user = process.env.ZOHO_EMAIL;
  const to   = process.env.REPORT_TO_EMAIL || user;
  if (!user || !to) return;

  const subject = `HOT LEAD — ${draft.company} replied (${draft.intent})`;
  const body = [
    `HOT LEAD — action recommended now`,
    ``,
    `${draft.company} sent a high-intent reply. Draft queued below.`,
    `This broke out of the daily digest because intent is high-confidence positive.`,
    ``,
    formatDraftBlock(draft),
    ``,
    `Reply Agent MTD: $${cfg.spentThisMonth.toFixed(4)} / $${cfg.costCapMonthly.toFixed(2)} cap`,
  ].join('\n');

  try {
    await makeTransport().sendMail({
      from:    `"Trevo Reply Agent" <${user}>`,
      to,
      subject,
      text:    body,
    });
    log(`HOT ALERT sent for ${draft.company}`);
  } catch (e) {
    log(`WARN: hot alert failed — ${e.message}`);
  }
}

// ── SHOW DRAFTS ──────────────────────────────────────────────────────────────

function showDrafts() {
  const q = loadDrafts();
  const pending = (q.drafts || []).filter(d => d.status === 'pending');
  if (pending.length === 0) { console.log('\nNo pending drafts.\n'); return; }
  console.log(`\n${pending.length} pending draft(s):\n`);
  for (const d of pending) console.log(formatDraftBlock(d));
  console.log(`\nQueue file: ${DRAFTS_PATH}`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  if (SHOW_DRAFTS) { showDrafts(); return; }

  const cfg     = loadConfig();
  const raState = loadRAState();
  const draftQ  = loadDrafts();

  log(`Reply Agent starting${DRY_RUN ? ' [DRY RUN]' : ''}`);
  log(`Cost MTD: $${cfg.spentThisMonth.toFixed(4)} / $${cfg.costCapMonthly.toFixed(2)}`);

  if (!cfg.enabled) { log('Reply Agent disabled (enabled: false in config).'); return; }

  if (!cfg.avgJobValue && !cfg.missRatePct) {
    log('INFO: gap economics unset — Claude will use qualitative framing (set avgJobValue / missRatePct in config for concrete numbers).');
  }

  const emailIndex = buildEmailIndex();
  log(`Lead index: ${emailIndex.size} email leads in queue/`);

  // Poll IMAP — updates raState.processedMessageIds in place
  const replies = await pollReplies(raState, emailIndex);
  // Save processed IDs immediately so a crash mid-processing doesn't cause re-drafts
  saveRAState(raState);

  if (replies.length === 0) {
    log('No new replies to process.');
  }

  const { classify } = require('./reply-classifier');

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch { log('✗ @anthropic-ai/sdk not installed'); process.exit(1); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { log('ANTHROPIC_API_KEY not set'); process.exit(1); }
  const claudeClient = new Anthropic({ apiKey });

  const hotLeads = [];
  let drafted = 0, skippedOptOut = 0, skippedAutoReply = 0, skippedDedup = 0;
  let capHit  = false;

  for (const reply of replies) {
    const { lead, messageId, fromAddr, subject, bodyText, receivedAt } = reply;
    const { brief, leadId }   = lead;
    const replyDate           = (receivedAt || '').split('T')[0] || today();

    // Dedup layer 2: check draft queue in case state was reset
    if (draftQ.drafts.some(d => d.messageId === messageId)) {
      skippedDedup++; continue;
    }

    // Keyword classification (free — no API call)
    const { intent, confidence: intentConfidence } = classify(bodyText || '', subject);

    log(`  ${brief.business_name}: intent=${intent} (${intentConfidence}) — "${subject.slice(0, 60)}"`);

    // Auto-replies get no draft
    if (intent === 'auto_reply') { skippedAutoReply++; continue; }

    // Opt-outs: update Sheet immediately, no draft
    if (intent === 'stop' || intent === 'negative') {
      const note = `opt-out (${intent}), set do not contact`;
      await updateSheetForReply(fromAddr, brief, 'do not contact', note, replyDate, subject.slice(0, 80), true);
      appendToThread(leadId, {
        messageId, receivedAt, intent,
        bodySnippet: bodyText.slice(0, 200),
        agentDraftId: null, agentDraftSnippet: null,
      });
      skippedOptOut++;
      continue;
    }

    // Check cost cap before any Claude call
    if (!checkCap(cfg)) { capHit = true; break; }

    // Load prior thread for multi-touch context
    const thread = loadThread(leadId);

    // Single Claude call: personality type + gap-selling draft
    let claudeResult = null;
    if (!DRY_RUN) {
      try {
        claudeResult = await generateDraft(claudeClient, cfg, brief, reply, thread, intent, intentConfidence);
      } catch (e) {
        log(`  WARN: Claude error for ${brief.business_name}: ${e.message}`);
      }

      if (claudeResult?.usage) {
        const cost = calcCost(claudeResult.usage, cfg.rates);
        recordCost(cfg, cost, claudeResult.usage);
        log(`  type=${claudeResult.type} (${claudeResult.typeConfidence}) cost=$${cost.toFixed(5)}`);
      }
    } else {
      claudeResult = {
        type: 'assertive', typeConfidence: 'low',
        gapRead: '[dry-run: not generated]',
        draftSubject: `Re: ${subject}`,
        draftBody: '[dry-run: draft body not generated — run without --dry-run to call Claude]',
      };
      log(`  [dry-run] Would call Claude for ${brief.business_name}`);
    }

    if (!claudeResult) continue;

    // Hot lead: positive with high keyword confidence
    const isHotLead = HOT_INTENTS.has(intent) && intentConfidence === 'high';

    const draftId = `${leadId}_${Date.now()}`;
    const draftEntry = {
      id:                   draftId,
      leadId,
      messageId,
      company:              brief.business_name || leadId,
      email:                fromAddr,
      trade:                brief.trade || '',
      city:                 (brief.city || '').replace(/,\s*[A-Z]{2}$/, ''),
      intent,
      intentConfidence,
      personalityType:      claudeResult.type,
      personalityConfidence: claudeResult.typeConfidence,
      gapRead:              claudeResult.gapRead,
      draftSubject:         claudeResult.draftSubject,
      draftBody:            claudeResult.draftBody,
      agentDraftedVersion:  claudeResult.draftBody,   // immutable — for edit-diff logging
      sentVersion:          null,                       // Dave fills after sending (optional)
      replySubject:         subject,
      replyBodySnippet:     bodyText.slice(0, 300),
      receivedAt,
      draftedAt:            new Date().toISOString(),
      status:               'pending',
      isHotLead,
      notifiedAt:           null,
    };

    draftQ.drafts.push(draftEntry);
    drafted++;
    if (isHotLead) hotLeads.push(draftEntry);

    // Update Sheet status → replied, append terse note
    const noteText = `replied, type ${claudeResult.type} (${claudeResult.typeConfidence}), intent ${intent}, draft queued`;
    await updateSheetForReply(fromAddr, brief, 'replied', noteText, replyDate, subject.slice(0, 80), false);

    // Append to thread (enables multi-touch context on next reply)
    appendToThread(leadId, {
      messageId, receivedAt, intent,
      bodySnippet:       bodyText.slice(0, 200),
      agentDraftId:      draftId,
      agentDraftSnippet: claudeResult.draftBody?.slice(0, 200) || '',
    });

    // Stagger Claude calls
    if (!DRY_RUN && replies.indexOf(reply) < replies.length - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Persist draft queue with all new entries
  saveDrafts(draftQ);

  // Hot-lead immediate notifications (break out of daily digest)
  for (const hot of hotLeads) {
    await sendHotAlert(hot, cfg);
    hot.notifiedAt = new Date().toISOString();
  }
  if (hotLeads.length > 0) saveDrafts(draftQ); // persist notifiedAt timestamps

  // Batched daily digest (once per calendar day, first run that has pending drafts)
  const pendingDrafts = draftQ.drafts.filter(d => d.status === 'pending');
  if (
    cfg.digestMode === 'batched' &&
    pendingDrafts.length > 0 &&
    raState.lastDigestSentAt !== today()
  ) {
    await sendDigest(pendingDrafts, cfg);
    raState.lastDigestSentAt = today();
  }

  // Final state save
  raState.lastRunAt = new Date().toISOString();
  saveRAState(raState);

  log(`Done — drafted: ${drafted}  opt-outs: ${skippedOptOut}  auto-replies: ${skippedAutoReply}  dedup-skipped: ${skippedDedup}${capHit ? '  COST CAP HIT' : ''}`);
  log(`Pending drafts in queue: ${pendingDrafts.length}`);
  log(`Cost MTD: $${cfg.spentThisMonth.toFixed(4)} / $${cfg.costCapMonthly.toFixed(2)}`);
}

main().catch(e => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
