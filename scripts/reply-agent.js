#!/usr/bin/env node
/**
 * Reply Agent — reads inbound Zoho replies from known leads, understands each
 * with Claude Haiku, and deposits a ready-to-send draft into the Zoho Drafts
 * folder. Review in Zoho Mail, edit if needed, hit Send. NOTHING IS AUTO-SENT.
 *
 * This SUPERSEDES scripts/poller.js (Option A — it absorbs the poller's IMAP
 * connect, Message-ID dedup, out-of-office filter, and lead matching, then adds
 * body extraction + a Haiku-drafted reply). It marks matched leads
 * `reply_drafted` (NOT `positive`), so mobile.js does not auto-send for email —
 * you send from Zoho. SMS replies (webhook.js) and the Nora upsell are untouched.
 *
 * Scope: KNOWN-LEAD replies only. Senders with no matching lead are skipped.
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
 * Writes: Zoho "Drafts" mailbox   messages/*-sent.json   state.json
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

// ── CONFIG ──────────────────────────────────────────────────────────────────

function today()        { return new Date().toISOString().split('T')[0]; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (cfg.current_month !== currentMonth()) {
    cfg.current_month   = currentMonth();
    cfg.spent_this_month = 0;
  }
  if (cfg.today !== today()) {
    cfg.today = today();
    cfg.processed_today = 0;
  }
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

/**
 * Strip quoted history and signature from a reply body so the model sees only
 * what the lead actually wrote this turn. Exported for tests.
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
  // Signature: cut at the standard "-- " delimiter or common mobile sig lines
  body = body.split(/\n-- \n/)[0];
  body = body.replace(/\n+Sent from my (iPhone|iPad|Android|mobile).*/is, '');
  return body.trim();
}

// ── LEAD LOOKUP (by sender email → lead) ────────────────────────────────────

function buildEmailIndex() {
  const index = new Map(); // normalizedEmail → { brief, leadId, sentPath }
  if (!fs.existsSync(QUEUE_DIR)) return index;
  for (const file of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
    try {
      const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      const email = normalizeEmail(brief.email);
      if (!email) continue;
      const leadId = file.replace('-brief.json', '');
      index.set(email, { brief, leadId, sentPath: path.join(MESSAGES_DIR, `${leadId}-sent.json`) });
    } catch { /* skip */ }
  }
  return index;
}

function loadSentRecord(sentPath) {
  if (!fs.existsSync(sentPath)) return null;
  try { return JSON.parse(fs.readFileSync(sentPath, 'utf8')); }
  catch { return null; }
}

// The text we originally sent the lead — used as context so the reply is on-topic.
function originalPitch(brief, sent) {
  return (sent && (sent.sent_message || sent.message || sent.body))
      || brief.cold_message
      || '(original outreach not on file)';
}

// ── STATE + RECORD UPDATES ──────────────────────────────────────────────────

function updateState(leadId, status) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const entry = (state.queue || []).find(l => l.lead_id === leadId);
    if (entry) {
      entry.status            = status;
      entry.reply_received_at = new Date().toISOString();
      if (!isDryRun) fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    }
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

// ── HAIKU DRAFT ─────────────────────────────────────────────────────────────

// Cached system prompt — billed once per session, then cheap reads.
const SYSTEM_PROMPT = `You are Dave, founder of Trevo Advisors — a small agency that builds websites for home service contractors (plumbers, electricians, handymen, roofers).

A lead you cold-emailed has replied. You will be given their reply, the message you originally sent them, and a few facts about their business. Write the body of a short, friendly, human reply that Dave can review and send.

Pricing facts you may state (only if relevant): a website is a flat $100 one-time build with NO monthly fee. AI add-ons (Nora AI phone agent, Atlas lead follow-up, Argus review responder) are $100 build + $65/mo. Never invent discounts, guarantees, or commitments beyond these.

Rules for draft_reply:
- Address what they actually said. If they asked a question, answer it directly.
- Keep it to 2-5 short sentences. Warm, plain, no corporate filler, no hype.
- If they want to talk, suggest a quick 15-minute call and point them to trevoadvisors.com/start.
- Do NOT add a greeting line with their name unless natural, and do NOT add a sign-off or signature — a signature is appended automatically. End with your last real sentence.
- If the request is sensitive (pricing negotiation, a complaint, legal/contract question, or anything you're unsure about), still write a safe, brief holding reply ("happy to hop on a quick call to walk through that") and set needs_human_note to a one-line flag explaining why.

Respond ONLY with a valid JSON object with keys:
  intent            (one of: interested | question | objection | neutral)
  summary           (one sentence: what the lead wants)
  draft_reply       (the reply body, no signature)
  confidence        (high | medium | low)
  needs_human_note  (empty string, or a one-line flag if it needs careful review)
No markdown, no explanation.`;

async function draftReply(client, cfg, { leadBody, pitch, brief }) {
  const facts = {
    business_name: brief.business_name,
    trade:         brief.trade,
    city:          brief.city,
    website:       brief.website || '(none)'
  };
  const pitchClipped = pitch.slice(0, cfg.max_thread_chars);
  const bodyClipped  = leadBody.slice(0, cfg.max_thread_chars);

  const userContent =
`LEAD FACTS:
${JSON.stringify(facts, null, 2)}

WHAT WE ORIGINALLY SENT THEM:
${pitchClipped}

THEIR REPLY (this is what to respond to):
${bodyClipped}`;

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

/**
 * Build a threaded plain-text reply as an RFC-822 message for IMAP APPEND.
 * Exported for tests.
 */
function buildDraftMime({ fromEmail, toEmail, subject, inReplyTo, references, bodyText }) {
  const from    = `"Dave" <${fromEmail}>`;
  const reSubj  = /^re:/i.test(subject || '') ? subject : `Re: ${subject || '(no subject)'}`;
  const irt     = foldMessageId(inReplyTo);
  const refs    = (references || []).map(foldMessageId).filter(Boolean);
  if (irt && !refs.includes(irt)) refs.push(irt);
  const genId   = `<${Date.now()}.${Math.random().toString(36).slice(2)}@trevoadvisors.com>`;

  const headers = [
    `Message-ID: ${genId}`,
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${toEmail}`,
    `Subject: ${reSubj}`,
    irt  ? `In-Reply-To: ${irt}` : null,
    refs.length ? `References: ${refs.join(' ')}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);

  return headers.join('\r\n') + '\r\n\r\n' + bodyText.replace(/\n/g, '\r\n');
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

  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!user || !pass) { console.error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local'); process.exit(1); }
  if (!apiKey)        { console.error('ANTHROPIC_API_KEY must be set in .env.local'); process.exit(1); }

  let ImapFlow, simpleParser;
  try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); }
  catch { console.error('\n✗ Missing deps. Run:\n  npm install imapflow mailparser\n'); process.exit(1); }

  const client    = new Anthropic({ apiKey });
  const emailIdx  = buildEmailIndex();
  const processed = new Set(cfg.processed_ids || []);

  log(`Polling Zoho IMAP for ${user} — ${emailIdx.size} lead email(s) indexed`);

  const imap = new ImapFlow({ host: 'imap.zoho.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await imap.connect();

  let checked = 0, drafted = 0, optedOut = 0, skipped = 0, capped = 0;

  try {
    const lock = await imap.getMailboxLock('INBOX');
    try {
      const since = new Date(); since.setDate(since.getDate() - 30);
      const uids = await imap.search({ since });
      log(uids.length ? `Found ${uids.length} message(s) in the last 30 days` : 'No recent messages');

      for await (const msg of imap.fetch(uids, { uid: true, source: true })) {
        const parsed    = await simpleParser(msg.source);
        const messageId = parsed.messageId || String(msg.uid);
        if (processed.has(messageId)) { skipped++; continue; }
        processed.add(messageId);

        const fromAddr = normalizeEmail(parsed.from?.value?.[0]?.address);
        const subject  = parsed.subject || '(no subject)';
        const lead     = emailIdx.get(fromAddr);
        if (!lead) { skipped++; continue; }              // not a known lead — out of scope

        checked++;
        const leadBody = stripQuotedAndSignature(parsed.text || '');

        // Guardrail: opt-outs and out-of-office never reach the model.
        const { intent } = classify(leadBody, subject, parsed.headers);
        if (intent === 'auto_reply') {
          log(`Auto-reply skipped: ${lead.brief.business_name}`);
          skipped++; continue;
        }
        if (intent === 'stop' || intent === 'negative') {
          log(`✗ Opt-out from ${lead.brief.business_name} ("${leadBody.slice(0, 40)}") — marked unsubscribed, no draft`);
          updateSentRecord(lead.sentPath, {
            status: 'unsubscribed', unsubscribed_at: new Date().toISOString(),
            reply_channel: 'email', reply_from: fromAddr, reply_text: leadBody
          });
          updateState(lead.leadId, 'unsubscribed');
          optedOut++; continue;
        }

        // Cost cap — checked before every model call.
        if (cfg.spent_this_month >= cfg.monthly_cap) {
          log(`CAP REACHED ($${cfg.spent_this_month.toFixed(4)} / $${cfg.monthly_cap.toFixed(2)}) — ${lead.brief.business_name} left for next run/month`);
          processed.delete(messageId);   // don't burn the dedup slot — retry next run
          capped++; continue;
        }

        try {
          const sent  = loadSentRecord(lead.sentPath);
          const pitch = originalPitch(lead.brief, sent);
          const { parsed: out, usage } = await draftReply(client, cfg, { leadBody, pitch, brief: lead.brief });

          const cost = calcCost(usage, cfg.rates);
          recordAnthropic(cost, 'reply-agent', usage);
          cfg.spent_this_month = parseFloat((cfg.spent_this_month + cost).toFixed(6));
          cfg.processed_today += 1;
          cfg.total_drafted   += 1;

          const flag     = out.needs_human_note ? `[REVIEW: ${out.needs_human_note}]\n\n` : '';
          const bodyText = `${flag}${(out.draft_reply || '').trim()}\n\n${cfg.signature}`;

          const mime = buildDraftMime({
            fromEmail:  user,
            toEmail:    parsed.from?.value?.[0]?.address || fromAddr,
            subject,
            inReplyTo:  messageId,
            references: [].concat(parsed.references || []),
            bodyText
          });

          console.log('\n' + '═'.repeat(56));
          console.log(`DRAFT for ${lead.brief.business_name} (${lead.brief.city})`);
          console.log(`Their reply : "${leadBody.slice(0, 120)}"`);
          console.log(`Intent      : ${out.intent} (${out.confidence})${out.needs_human_note ? '  ⚠ ' + out.needs_human_note : ''}`);
          console.log('─'.repeat(56));
          console.log(bodyText);
          console.log('═'.repeat(56));

          if (isDryRun) {
            log(`DRY RUN — would append draft for ${lead.brief.business_name} ($${cost.toFixed(5)})`);
          } else {
            await imap.append(cfg.drafts_mailbox, mime, ['\\Draft']);
            updateSentRecord(lead.sentPath, {
              status: 'reply_drafted', replied_at: new Date().toISOString(),
              reply_channel: 'email', reply_from: fromAddr, reply_subject: subject,
              reply_text: leadBody, draft_intent: out.intent, draft_flag: out.needs_human_note || ''
            });
            updateState(lead.leadId, 'reply_drafted');
            log(`✓ Draft in Zoho Drafts for ${lead.brief.business_name} ($${cost.toFixed(5)})`);
          }
          drafted++;
        } catch (err) {
          log(`ERROR drafting for ${lead.brief.business_name}: ${err.message}`);
          processed.delete(messageId);   // let a transient failure retry next run
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout();
  }

  cfg.processed_ids = [...processed].slice(-1000);
  cfg.last_run      = new Date().toISOString();
  saveConfig(cfg);

  console.log('\n' + '─'.repeat(56));
  console.log(`Done — matched: ${checked}  drafted: ${drafted}  opted-out: ${optedOut}  skipped: ${skipped}${capped ? `  capped: ${capped}` : ''}`);
  console.log(`Spend: $${cfg.spent_this_month.toFixed(4)} / $${cfg.monthly_cap.toFixed(2)} this month`);
  if (drafted && !isDryRun) console.log(`\nReview your drafts in Zoho Mail → Drafts, then Send.`);
  console.log('─'.repeat(56));
}

// Exported for unit tests; only run when invoked directly.
module.exports = { stripQuotedAndSignature, buildDraftMime, foldMessageId };

if (require.main === module) {
  main().catch(err => { console.error('Unexpected error:', err.message); process.exit(1); });
}
