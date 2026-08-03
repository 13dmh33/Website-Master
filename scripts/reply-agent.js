#!/usr/bin/env node
/**
 * Reply Agent — reads inbound Zoho replies from known leads, understands each
 * with Claude Haiku, and deposits a ready-to-send draft into the Zoho Drafts
 * folder. Review in Zoho Mail, edit if needed, hit Send. NOTHING IS AUTO-SENT.
 *
 * This SUPERSEDES scripts/poller.js (Option A — it absorbs the poller's IMAP
 * connect, Message-ID dedup, out-of-office filter, and lead matching, then adds
 * body extraction + a GAP-selling Haiku-drafted reply). It marks matched leads
 * `reply_drafted` (NOT `positive`), so mobile.js does not auto-send for email —
 * you send from Zoho. SMS replies (webhook.js) and the Nora upsell are untouched.
 *
 * Scope: KNOWN-LEAD replies only. Senders with no matching lead are skipped.
 *
 * Flow per run:
 *   1. Search INBOX for messages above the last-processed UID (30-day floor on
 *      first run), fetch envelopes only (cheap).
 *   2. Keep new messages from known-lead senders; download the full source for
 *      only those.
 *   3. After the IMAP fetch is fully drained, run the classifier guardrail +
 *      Haiku draft and APPEND each draft to the Drafts folder. (IMAP commands
 *      are never issued while a fetch stream is open.)
 *
 * Usage:
 *   node scripts/reply-agent.js --force            (check inbox + write drafts)
 *   node scripts/reply-agent.js --force --dry-run  (classify + draft, print only, no writes)
 *
 * Cron (Mac, 4x/day — Zoho IMAP is blocked from the container):
 *   0 8,12,16,20 * * * cd ~/Website-Master && /usr/local/bin/node scripts/reply-agent.js --force >> logs/reply-agent-cron.log 2>&1
 *
 * Requires (run once on Mac after git pull):  npm install imapflow mailparser
 *
 * Reads:  queue/*-brief.json   messages/*-sent.json   config/reply-agent-config.json
 *         .env.local (ZOHO_EMAIL, ZOHO_APP_PASSWORD, ANTHROPIC_API_KEY)
 * Writes: Zoho Drafts mailbox   messages/*-sent.json   state.json
 *         config/reply-agent-config.json   logs/reply-agent-*.log
 */

const fs   = require('fs');
const path = require('path');

const { classify }        = require('./reply-classifier');
const { recordAnthropic } = require('./cost-tracker');

const ROOT         = path.join(__dirname, '..');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STATE_PATH   = path.join(ROOT, 'state.json');
const LOGS_DIR     = path.join(ROOT, 'logs');
const CONFIG_PATH  = path.join(ROOT, 'config', 'reply-agent-config.json');

const isDryRun = process.argv.includes('--dry-run');
const hasForce = process.argv.includes('--force');
// First-ever run (last_uid = 0) defaults to a 30-day lookback, but this
// campaign's outreach goes back to 2026-06-01 — a first run on today's date
// would silently never see anything older than 30 days, since last_uid then
// advances past it forever. --since-days N overrides the window for exactly
// that one-time historical catch-up; ongoing runs (last_uid > 0) ignore this
// and always resume from the UID high-water mark instead.
const sinceDaysArgIdx = process.argv.indexOf('--since-days');
const sinceDaysOverride = sinceDaysArgIdx !== -1 ? Number(process.argv[sinceDaysArgIdx + 1]) : null;

// ── CONFIG ──────────────────────────────────────────────────────────────────

function today()        { return new Date().toISOString().split('T')[0]; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (cfg.current_month !== currentMonth()) { cfg.current_month = currentMonth(); cfg.spent_this_month = 0; }
  if (cfg.today !== today())                { cfg.today = today(); cfg.processed_today = 0; }
  return cfg;
}

function saveConfig(cfg) {
  if (!isDryRun) fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function calcCost(usage, rates) {
  return (usage.input_tokens              || 0) / 1e6 * rates.input_per_mtok
       + (usage.output_tokens             || 0) / 1e6 * rates.output_per_mtok
       + (usage.cache_creation_input_tokens || 0) / 1e6 * rates.cache_write_per_mtok
       + (usage.cache_read_input_tokens     || 0) / 1e6 * rates.cache_read_per_mtok;
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function normalizeEmail(raw) { return (raw || '').toLowerCase().trim(); }

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, `reply-agent-${ts.split('T')[0]}.log`), line + '\n');
}

/** Crude HTML → text, used only when a reply has no plain-text part. Exported for tests. */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strip quoted history and signature so the model sees only what the lead wrote
 * this turn. Exported for tests.
 */
function stripQuotedAndSignature(text) {
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const QUOTE_MARKERS = [
    /^\s*On .+ wrote:\s*$/i,                       // Gmail/Apple "On <date>, <name> wrote:"
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,   // Outlook
    /^\s*_{5,}\s*$/,                               // Outlook divider line
    /^\s*From:\s.+$/i,                             // forwarded header block
    /^\s*>{1,}/                                    // quoted lines
  ];
  const out = [];
  for (const line of lines) {
    if (QUOTE_MARKERS.some(re => re.test(line))) break;
    out.push(line);
  }
  let body = out.join('\n');
  body = body.split(/\n--[ \t]?\n/)[0];                                  // "-- " sig delimiter (trailing space optional)
  body = body.replace(/\n+Sent from my (iPhone|iPad|Android|mobile).*/is, '');
  return body.trim();
}

/** RFC-2047 encode a header value if it contains non-ASCII. Exported for tests. */
function encodeHeaderWord(s) {
  if (!s) return s || '';
  if (/^[\x00-\x7F]*$/.test(s)) return s;                                // pure ASCII — leave as-is
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

// ── LEAD LOOKUP (by sender email → lead) ────────────────────────────────────

/**
 * Index every address we have actually emailed, so a reply from any of them is
 * recognised as a known lead.
 *
 * Two sources, because neither alone is complete:
 *
 *   queue/*-brief.json    richer (trade, city, diagnosis) and what the Haiku
 *                         draft prefers, but briefs go missing — 205 leads at
 *                         'checked' currently have no brief file at all.
 *   messages/*-sent.json  the authoritative record of who we actually sent to.
 *
 * Indexing briefs alone missed 112 addresses that had really been emailed
 * (162 indexed against 228 in sent records, measured 2026-08-03). A reply from
 * any of those was silently counted as "not a known lead" and skipped — which
 * is indistinguishable, in the run summary, from nobody having replied at all.
 * That matters most for the oldest contacts, exactly the ones whose briefs are
 * likeliest to be gone.
 *
 * The brief wins when both exist, so draft quality is unchanged for leads that
 * still have one.
 */
function buildEmailIndex() {
  const index = new Map(); // normalizedEmail → { brief, leadId, sentPath }

  // Sent records first, so a brief can overwrite with the richer record.
  if (fs.existsSync(MESSAGES_DIR)) {
    for (const file of fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json'))) {
      try {
        const sent = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, file), 'utf8'));
        const email = normalizeEmail(sent.email);
        if (!email) continue;
        const leadId = file.replace('-sent.json', '');
        index.set(email, {
          // Minimal brief-shaped record from what the sent log preserved.
          brief: {
            lead_id: leadId,
            business_name: sent.business_name,
            email: sent.email,
            phone: sent.phone,
            city: sent.city,
            trade: sent.trade,
          },
          leadId,
          sentPath: path.join(MESSAGES_DIR, file),
        });
      } catch { /* skip */ }
    }
  }

  if (fs.existsSync(QUEUE_DIR)) {
    for (const file of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
      try {
        const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
        const email = normalizeEmail(brief.email);
        if (!email) continue;
        const leadId = file.replace('-brief.json', '');
        index.set(email, { brief, leadId, sentPath: path.join(MESSAGES_DIR, `${leadId}-sent.json`) });
      } catch { /* skip */ }
    }
  }

  return index;
}

function loadSentRecord(sentPath) {
  if (!fs.existsSync(sentPath)) return null;
  try { return JSON.parse(fs.readFileSync(sentPath, 'utf8')); }
  catch { return null; }
}

/** The text we originally sent the lead — context so the reply stays on-topic. */
function originalPitch(brief, sent) {
  return (sent && (sent.sent_message || sent.message || sent.body))
      || brief.cold_message
      || '(original outreach not on file)';
}

// ── STATE + RECORD UPDATES ──────────────────────────────────────────────────

/** Apply a batch of {leadId, status} updates to state.json in a single write. */
function applyStateUpdates(updates) {
  if (isDryRun || updates.length === 0) return;
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const now   = new Date().toISOString();
    for (const { leadId, status } of updates) {
      const entry = (state.queue || []).find(l => l.lead_id === leadId);
      if (entry) { entry.status = status; entry.reply_received_at = now; }
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`WARN: could not update state.json — ${e.message}`);
  }
}

function updateSentRecord(sentPath, patch) {
  if (isDryRun || !fs.existsSync(sentPath)) return;
  try {
    const rec = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
    Object.assign(rec, patch);
    fs.writeFileSync(sentPath, JSON.stringify(rec, null, 2));
  } catch (e) {
    log(`WARN: could not update ${path.basename(sentPath)} — ${e.message}`);
  }
}

// ── HAIKU DRAFT (GAP selling) ───────────────────────────────────────────────

// Cached system prompt — billed once per session, then cheap reads.
const SYSTEM_PROMPT = `You are Dave, founder of Trevo Advisors — a small agency that builds websites for home service contractors (plumbers, electricians, handymen, roofers).

A contractor you cold-emailed has replied. Write the body of a short reply that Dave can review and send. You will be given their reply, a diagnosis of their current website gap, the message Dave originally sent, and facts about their business.

SELL USING THE GAP METHOD. Sell the gap between their CURRENT STATE and a better FUTURE STATE, anchored on business impact — problem-first, never a feature list. Every draft must:
1. Acknowledge what they actually said first (answer a question directly if they asked one).
2. Name their specific current-state gap using the diagnosis and facts provided — be concrete (weak or missing site, review count vs. no site to show it on, outdated look, invisible on Google). Do not be generic.
3. Connect the gap to business impact honestly: searchers who can't find them (or find a bare listing) book the competitor instead. Never invent statistics or dollar figures.
4. Point to the future state the $100 site closes — more of those searchers turning into booked jobs, and looking as credible as the work they do.
5. Advance with exactly ONE thing: either a question that makes them quantify or feel the gap (e.g. "roughly how many calls a week do you figure you're missing when people can't find you online?"), or a concrete next step (a quick 15-min call, or the live demo at trevoadvisors.com/start). Not both.

Pricing facts you may state (only if relevant): a website is a flat $100 one-time build with NO monthly fee. AI add-ons (Nora AI phone agent, Atlas lead follow-up, Argus review responder) are $100 build + $65/mo. Never invent discounts, guarantees, or commitments beyond these.

Style: match the provided tone. 2-5 short sentences. Warm, plain, human — no corporate filler, no hype, no exclamation-point spam. Do NOT open with the recipient's name unless natural, and do NOT add a sign-off or signature — a signature is appended automatically; end on your last real sentence.

If the request is sensitive (pricing negotiation, a complaint, a legal/contract question, or anything you're unsure about), still write a safe, brief holding reply ("happy to hop on a quick call to walk through that") and set needs_human_note to a one-line flag explaining why.

Respond ONLY with a valid JSON object with keys:
  intent            (one of: interested | question | objection | neutral)
  summary           (one sentence: what the lead wants)
  draft_reply       (the reply body, no signature)
  confidence        (high | medium | low)
  needs_human_note  (empty string, or a one-line flag if it needs careful review)
No markdown, no explanation.`;

async function draftReply(client, cfg, { leadBody, pitch, brief }) {
  const facts = {
    business_name:   brief.business_name,
    trade:           brief.trade,
    city:            brief.city,
    website:         brief.website || '(none)',
    review_count:    brief.review_count,
    rating:          brief.rating,
    gap_diagnosis:   brief.diagnosis  || '',
    strongest_angle: brief.hero_angle || '',
    tone:            brief.tone       || 'direct'
  };

  const userContent =
`LEAD FACTS + CURRENT-STATE GAP:
${JSON.stringify(facts, null, 2)}

WHAT DAVE ORIGINALLY SENT THEM:
${pitch.slice(0, cfg.max_thread_chars)}

THEIR REPLY (this is what to respond to):
${leadBody.slice(0, cfg.max_thread_chars)}`;

  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: 500,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }]
  });

  const raw = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`); }
  return { parsed, usage: response.usage };
}

// ── RFC-822 DRAFT (threaded) ────────────────────────────────────────────────

function foldMessageId(id) {
  if (!id) return null;
  return id.trim().startsWith('<') ? id.trim() : `<${id.trim()}>`;
}

/** Build a threaded plain-text reply as an RFC-822 message for IMAP APPEND. Exported for tests. */
function buildDraftMime({ fromEmail, toEmail, subject, inReplyTo, references, bodyText }) {
  const from   = `"Dave" <${fromEmail}>`;
  const reSubj = /^re:/i.test(subject || '') ? subject : `Re: ${subject || '(no subject)'}`;
  const irt    = foldMessageId(inReplyTo);
  const refs   = (references || []).map(foldMessageId).filter(Boolean);
  if (irt && !refs.includes(irt)) refs.push(irt);
  const genId  = `<${Date.now()}.${Math.random().toString(36).slice(2)}@trevoadvisors.com>`;

  const headers = [
    `Message-ID: ${genId}`,
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${encodeHeaderWord(reSubj)}`,
    irt  ? `In-Reply-To: ${irt}` : null,
    refs.length ? `References: ${refs.join(' ')}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);

  return headers.join('\r\n') + '\r\n\r\n' + bodyText.replace(/\n/g, '\r\n');
}

// ── DRAFTS MAILBOX RESOLUTION ───────────────────────────────────────────────

// Prefer the server's special-use \Drafts folder (survives localization), then
// the configured name. Returns the resolved path, or null if not found.
async function resolveDraftsMailbox(imap, configured) {
  const boxes = await imap.list();
  const special = boxes.find(b => b.specialUse === '\\Drafts');
  if (special) return special.path;
  const named = boxes.find(b => b.path === configured || b.name === configured);
  return named ? named.path : null;
}

// ── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nReply Agent starting${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log('─'.repeat(56));

  const cfg = loadConfig();

  if (!hasForce && !cfg.auto_run) {
    console.log('Reply Agent is in manual mode (auto_run = false).');
    console.log('Run with --force, or set auto_run = true in config/reply-agent-config.json.');
    process.exit(0);
  }

  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
  const Anthropic = require('@anthropic-ai/sdk');

  const user   = process.env.ZOHO_EMAIL;
  const pass   = process.env.ZOHO_APP_PASSWORD;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!user || !pass) { console.error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local'); process.exit(1); }
  if (!apiKey)        { console.error('ANTHROPIC_API_KEY must be set in .env.local'); process.exit(1); }

  let ImapFlow, simpleParser;
  try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); }
  catch { console.error('\n✗ Missing deps. Run:\n  npm install imapflow mailparser\n'); process.exit(1); }

  const client    = new Anthropic({ apiKey });
  const emailIdx  = buildEmailIndex();
  const processed = new Set(cfg.processed_ids || []);
  const lastUid   = cfg.last_uid || 0;

  log(`Polling Zoho IMAP for ${user} — ${emailIdx.size} lead email(s) indexed (from UID ${lastUid + 1 || 1})`);

  const imap = new ImapFlow({ host: 'imap.zoho.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await imap.connect();

  let checked = 0, drafted = 0, optedOut = 0, skipped = 0, capped = 0, errored = 0;
  const stateUpdates = [];

  try {
    // Fail fast if we can't locate a Drafts folder — before spending on Haiku.
    const draftsPath = await resolveDraftsMailbox(imap, cfg.drafts_mailbox);
    if (!draftsPath && !isDryRun) {
      console.error(`\n✗ Could not find a Drafts mailbox (configured: "${cfg.drafts_mailbox}"). Set drafts_mailbox in config/reply-agent-config.json to your Zoho drafts folder name.`);
      await imap.logout();
      process.exit(1);
    }

    // ── Phase 1: cheap envelope scan → collect new, known-lead messages ──────
    const candidates = [];
    let   maxUid     = lastUid;
    const lock = await imap.getMailboxLock('INBOX');
    try {
      let searchRange;
      if (lastUid > 0) {
        searchRange = { uid: `${lastUid + 1}:*` };
      } else {
        const since = new Date();
        since.setDate(since.getDate() - (sinceDaysOverride || 30));
        searchRange = { since };
      }
      const uids = await imap.search(searchRange, { uid: true }) || [];
      log(uids.length ? `${uids.length} candidate UID(s) to scan` : 'No new messages');

      for await (const msg of imap.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
        if (msg.uid > maxUid) maxUid = msg.uid;
        if (msg.uid <= lastUid) continue;                       // "N:*" can echo the boundary msg
        const messageId = msg.envelope?.messageId || String(msg.uid);
        if (processed.has(messageId)) { skipped++; continue; }
        const fromAddr = normalizeEmail(msg.envelope?.from?.[0]?.address);
        const lead     = emailIdx.get(fromAddr);
        if (!lead) { skipped++; continue; }                     // not a known lead — out of scope
        candidates.push({
          uid: msg.uid, messageId, fromAddr, lead,
          subject: msg.envelope?.subject || '(no subject)'
        });
      }

      // ── Phase 2: download full source for only the messages we'll draft ────
      if (candidates.length) {
        const byUid = new Map(candidates.map(c => [c.uid, c]));
        for await (const msg of imap.fetch(candidates.map(c => c.uid), { uid: true, source: true }, { uid: true })) {
          const c = byUid.get(msg.uid);
          if (c) c.source = msg.source;
        }
      }
    } finally {
      lock.release();  // release INBOX before issuing APPENDs
    }

    // ── Phase 3: classify + draft + APPEND (no fetch stream open now) ────────
    let retryFloor = Infinity;   // lowest UID we must re-scan next run (cap/error)

    for (const c of candidates.filter(c => c.source)) {
      const parsed   = await simpleParser(c.source);
      const rawBody  = parsed.text || htmlToText(parsed.html || '');
      const leadBody = stripQuotedAndSignature(rawBody);
      const brief    = c.lead.brief;

      // Guardrail: opt-outs and out-of-office never reach the model.
      const { intent } = classify(leadBody, c.subject, parsed.headers);
      if (intent === 'auto_reply') {
        log(`Auto-reply skipped: ${brief.business_name}`);
        processed.add(c.messageId); skipped++; continue;
      }
      if (intent === 'stop' || intent === 'negative') {
        log(`✗ Opt-out from ${brief.business_name} ("${leadBody.slice(0, 40)}") — marked unsubscribed, no draft`);
        updateSentRecord(c.lead.sentPath, {
          status: 'unsubscribed', unsubscribed_at: new Date().toISOString(),
          reply_channel: 'email', reply_from: c.fromAddr, reply_text: leadBody
        });
        stateUpdates.push({ leadId: c.lead.leadId, status: 'unsubscribed' });
        processed.add(c.messageId); optedOut++; continue;
      }

      // Cost cap — checked before every model call. Leave capped msgs for retry.
      if (cfg.spent_this_month >= cfg.monthly_cap) {
        log(`CAP REACHED ($${cfg.spent_this_month.toFixed(4)} / $${cfg.monthly_cap.toFixed(2)}) — ${brief.business_name} left for next run`);
        retryFloor = Math.min(retryFloor, c.uid);
        capped++; continue;
      }

      checked++;
      try {
        const sent  = loadSentRecord(c.lead.sentPath);
        const pitch = originalPitch(brief, sent);
        const { parsed: out, usage } = await draftReply(client, cfg, { leadBody, pitch, brief });

        const cost = calcCost(usage, cfg.rates);
        recordAnthropic(cost, 'reply-agent', usage);
        cfg.spent_this_month = parseFloat((cfg.spent_this_month + cost).toFixed(6));
        cfg.processed_today += 1;
        cfg.total_drafted   += 1;

        const flag     = out.needs_human_note ? `[REVIEW: ${out.needs_human_note}]\n\n` : '';
        const bodyText = `${flag}${(out.draft_reply || '').trim()}\n\n${cfg.signature}`;
        const mime = buildDraftMime({
          fromEmail:  user,
          toEmail:    c.fromAddr,
          subject:    c.subject,
          inReplyTo:  c.messageId,
          references: [].concat(parsed.references || []),
          bodyText
        });

        console.log('\n' + '═'.repeat(56));
        console.log(`DRAFT for ${brief.business_name} (${brief.city})`);
        console.log(`Their reply : "${leadBody.slice(0, 120)}"`);
        console.log(`Intent      : ${out.intent} (${out.confidence})${out.needs_human_note ? '  ⚠ ' + out.needs_human_note : ''}`);
        console.log('─'.repeat(56));
        console.log(bodyText);
        console.log('═'.repeat(56));

        if (isDryRun) {
          log(`DRY RUN — would append draft for ${brief.business_name} ($${cost.toFixed(5)})`);
        } else {
          await imap.append(draftsPath, mime, ['\\Draft']);
          updateSentRecord(c.lead.sentPath, {
            status: 'reply_drafted', replied_at: new Date().toISOString(),
            reply_channel: 'email', reply_from: c.fromAddr, reply_subject: c.subject,
            reply_text: leadBody, draft_intent: out.intent, draft_flag: out.needs_human_note || ''
          });
          stateUpdates.push({ leadId: c.lead.leadId, status: 'reply_drafted' });
          log(`✓ Draft in Drafts for ${brief.business_name} ($${cost.toFixed(5)})`);
        }
        processed.add(c.messageId);
        drafted++;
      } catch (err) {
        log(`ERROR drafting for ${brief.business_name}: ${err.message}`);
        retryFloor = Math.min(retryFloor, c.uid);   // retry this message next run
        errored++;
      }
    }

    applyStateUpdates(stateUpdates);

    // Advance the high-water-mark, but never past a message we still owe a retry.
    cfg.last_uid = retryFloor === Infinity ? maxUid : Math.min(maxUid, retryFloor - 1);
  } finally {
    await imap.logout();
  }

  cfg.processed_ids = [...processed].slice(-1000);
  cfg.last_run      = new Date().toISOString();
  saveConfig(cfg);

  console.log('\n' + '─'.repeat(56));
  console.log(`Done — drafted: ${drafted}  opted-out: ${optedOut}  skipped: ${skipped}` +
              `${capped ? `  capped: ${capped}` : ''}${errored ? `  errored: ${errored}` : ''}`);
  console.log(`Spend: $${cfg.spent_this_month.toFixed(4)} / $${cfg.monthly_cap.toFixed(2)} this month`);
  if (drafted && !isDryRun) console.log(`\nReview your drafts in Zoho Mail → Drafts, then Send.`);
  console.log('─'.repeat(56));
}

// Exported for unit tests; only run when invoked directly.
module.exports = { stripQuotedAndSignature, buildDraftMime, foldMessageId, htmlToText, encodeHeaderWord };

if (require.main === module) {
  main().catch(err => { console.error('Unexpected error:', err.message); process.exit(1); });
}
