#!/usr/bin/env node
/**
 * ⚠ SUPERSEDED by scripts/reply-agent.js (2026-07-17).
 * The reply-agent absorbs this poller's IMAP connect, Message-ID dedup,
 * out-of-office filter, and lead matching, and adds a Claude-drafted reply
 * written to the Zoho Drafts folder for human review (nothing auto-sent).
 * It marks matched leads `reply_drafted` instead of `positive`, so a lead is
 * never both canned-auto-replied (mobile.js) AND hand-drafted. Do NOT run this
 * poller and the reply-agent against the same inbox on cron. Kept for reference.
 *
 * Email Reply Poller — checks Zoho inbox for replies, auto-updates lead status
 *
 * Mirrors the Twilio webhook (scripts/webhook.js) but for email.
 * Designed to run as a cron job every 15–30 minutes.
 *
 * Usage:
 *   node scripts/poller.js              (check + update)
 *   node scripts/poller.js --dry-run    (check only, no writes)
 *
 * Cron (every 15 min on Mac):
 *   *\/15 * * * * cd ~/Website-Master && /usr/local/bin/node scripts/poller.js >> logs/poller-cron.log 2>&1
 *
 * Requires: npm install imapflow   (run once on Mac after git pull)
 *
 * Reads:  queue/*-brief.json   messages/*-sent.json   config/poller-config.json
 * Writes: messages/*-sent.json  state.json  config/poller-config.json  logs/poller-*.log
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs   = require('fs');
const path = require('path');

// Shared intent classifier (keyword-based, zero API cost) — same module webhook.js
// is meant to use for SMS. Wired in here so email replies are routed by intent
// (opt-out / objection / positive / neutral) instead of blanket-marked positive.
const { classify, statusFor } = require('./reply-classifier');
// Reuse (do not duplicate) the reply-agent's quote/signature stripper and HTML→text
// helper so the classifier sees only what the lead wrote this turn.
const { stripQuotedAndSignature, htmlToText } = require('./reply-agent');

const ROOT         = path.join(__dirname, '..');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STATE_PATH   = path.join(ROOT, 'state.json');
const LOGS_DIR     = path.join(ROOT, 'logs');
const CONFIG_PATH  = path.join(ROOT, 'config', 'poller-config.json');

const isDryRun = process.argv.includes('--dry-run');

// Intent → status routing. Mirrors webhook.js's SMS behaviour:
//   sent   = status written to messages/<lead>-sent.json
//   state  = status written to state.json (so the reply is visible in the pipeline)
// neutral: still recorded as a reply in state.json (visibility) but the sent-record
// status is left untouched so mobile.js does not fire an auto-reply on an unclear message.
const REPLY_ROUTES = {
  stop:      { sent: 'unsubscribed', state: 'unsubscribed' },
  negative:  { sent: 'unsubscribed', state: 'unsubscribed' },
  objection: { sent: 'on_hold',      state: 'on_hold' },
  positive:  { sent: 'positive',     state: 'replied' },
  question:  { sent: 'positive',     state: 'replied' },
  neutral:   { sent: null,           state: 'replied' },
};

// Auto-reply detection patterns
const AUTO_REPLY_SUBJECTS = [
  'out of office', 'auto-reply', 'automatic reply', 'away from office',
  'on vacation', 'on leave', 'autoreply', 'auto response', 'automated response'
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

function normalizeEmail(raw) {
  return (raw || '').toLowerCase().trim();
}

function log(msg) {
  const ts      = new Date().toISOString();
  const dateKey = ts.split('T')[0];
  const line    = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, `poller-${dateKey}.log`), line + '\n');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { processed_ids: [], last_run: null };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  if (!isDryRun) fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function isAutoReply(envelope, headers) {
  if (!headers) return false;
  const subject = (envelope?.subject || '').toLowerCase();
  if (AUTO_REPLY_SUBJECTS.some(kw => subject.includes(kw))) return true;
  // Standard auto-reply headers
  const autoSubmitted = (headers?.get('auto-submitted') || '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (headers?.get('x-autoreply') || headers?.get('x-autorespond')) return true;
  return false;
}

// ── LEAD LOOKUP ───────────────────────────────────────────────────────────────

function buildEmailIndex() {
  const index = new Map(); // normalizedEmail → { brief, leadId, sentPath }
  if (!fs.existsSync(QUEUE_DIR)) return index;
  for (const file of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
    try {
      const brief  = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      const email  = normalizeEmail(brief.email);
      if (!email) continue;
      const leadId   = file.replace('-brief.json', '');
      const sentPath = path.join(MESSAGES_DIR, `${leadId}-sent.json`);
      index.set(email, { brief, leadId, sentPath });
    } catch { /* skip */ }
  }
  return index;
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status, meta = {}) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) {
      entry.status            = status;
      entry.reply_received_at = new Date().toISOString();
      // Additive-only: new fields recording the classified intent. Existing fields
      // (status, reply_received_at) keep their prior meaning.
      if (meta.intent)     entry.reply_intent     = meta.intent;
      if (meta.confidence) entry.reply_confidence = meta.confidence;
      entry.reply_channel = 'email';
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } else {
      log(`WARN: no state.json queue entry for ${leadId} — reply logged to sent record only`);
    }
  } catch (e) {
    log(`WARN: could not update state.json — ${e.message}`);
  }
}

/**
 * Classify an inbound email reply and route the lead by intent.
 * @param {object} args
 * @param {string} args.leadId
 * @param {string} args.sentPath
 * @param {object} args.brief
 * @param {string} args.subject
 * @param {string} args.fromEmail
 * @param {string} args.body       — cleaned reply text (quotes/signature stripped)
 * @param {object} [args.headers]  — IMAP headers map (auto-reply detection)
 */
function recordReply({ leadId, sentPath, brief, subject, fromEmail, body, headers }) {
  const { intent, confidence, notes } = classify(body, subject, headers);

  // Auto-replies (OOO, autoresponders) are not real replies — never touch status.
  if (intent === 'auto_reply') {
    log(`Auto-reply from ${fromEmail} ("${subject}") — ${notes}; no status change`);
    return { intent, changed: false };
  }

  const route = REPLY_ROUTES[intent] || REPLY_ROUTES.neutral;

  if (isDryRun) {
    log(`DRY RUN — ${brief.business_name}: intent="${intent}" (${confidence}) → state "${route.state}"${route.sent ? `, sent "${route.sent}"` : ''} (${notes})`);
    return { intent, changed: false };
  }

  if (!fs.existsSync(sentPath)) {
    log(`WARN: sent record not found at ${sentPath} — recording reply in state.json only`);
    updateState(leadId, route.state, { intent, confidence });
    return { intent, changed: true };
  }

  const sent = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
  if (sent.status === 'unsubscribed') {
    log(`${brief.business_name} already unsubscribed — leaving as-is`);
    return { intent, changed: false };
  }

  // Additive: record the reply on the sent record without discarding prior fields.
  sent.replied_at       = new Date().toISOString();
  sent.reply_subject    = subject;
  sent.reply_channel    = 'email';
  sent.reply_from       = fromEmail;
  sent.reply_intent     = intent;
  sent.reply_confidence = confidence;
  if (Array.isArray(sent.replies)) {
    sent.replies.push({ at: sent.replied_at, channel: 'email', intent, confidence, subject });
  }
  if (route.sent) sent.status = route.sent;   // neutral leaves status untouched
  fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));

  updateState(leadId, route.state, { intent, confidence });

  const hint = route.sent === 'positive'
    ? ' — run "node scripts/mobile.js" to send booking reply'
    : route.sent === 'unsubscribed'
      ? ' — suppressed from further outreach'
      : route.sent === 'on_hold'
        ? ' — drip paused, revisit later'
        : ' — flagged for manual review';
  log(`✓ ${brief.business_name}: reply intent "${intent}" (${confidence}) → ${route.state}${hint}`);
  return { intent, changed: true };
}

// ── IMAP POLL ─────────────────────────────────────────────────────────────────

async function pollInbox() {
  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch {
    console.error('\n✗ Missing deps. Run:\n  npm install imapflow mailparser\nthen retry.\n');
    process.exit(1);
  }

  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) {
    console.error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local');
    process.exit(1);
  }

  const cfg       = loadConfig();
  const processed = new Set(cfg.processed_ids || []);
  const emailIdx  = buildEmailIndex();

  log(`Polling Zoho IMAP for ${user} — ${emailIdx.size} leads indexed`);

  const client = new ImapFlow({
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false
  });

  await client.connect();

  let found = 0, matched = 0, skipped = 0;

  try {
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Search for all unseen messages (or since 30 days ago as a safety bound)
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const uids = await client.search({ since });

      if (uids.length === 0) {
        log('No new messages found');
      } else {
        log(`Found ${uids.length} message(s) to check`);
      }

      // Phase 1 — cheap envelope/header scan. Identify replies from known leads;
      // skip already-seen, auto-replies, and non-leads without fetching bodies.
      const candidates = [];
      for await (const msg of client.fetch(uids, {
        uid: true, envelope: true, headers: true
      })) {
        found++;
        const uid       = String(msg.uid);
        const envelope  = msg.envelope;
        const headers   = msg.headers;
        const messageId = envelope?.messageId || uid;

        if (processed.has(messageId)) { skipped++; continue; }

        const fromAddr  = envelope?.from?.[0]?.address || '';
        const fromNorm  = normalizeEmail(fromAddr);
        const subject   = envelope?.subject || '(no subject)';

        processed.add(messageId);

        if (isAutoReply(envelope, headers)) {
          log(`Auto-reply skipped: "${subject}" from ${fromAddr}`);
          continue;
        }

        const lead = emailIdx.get(fromNorm);
        if (!lead) {
          log(`No lead match for ${fromAddr} — skipped`);
          continue;
        }

        candidates.push({ uid: msg.uid, subject, fromAddr, headers, lead });
      }

      // Phase 2 — fetch the source only for known-lead replies, parse the body,
      // classify intent, and route (opt-out / objection / positive / neutral).
      if (candidates.length > 0) {
        const byUid = new Map(candidates.map(c => [c.uid, c]));
        for await (const msg of client.fetch(
          candidates.map(c => c.uid), { uid: true, source: true }, { uid: true }
        )) {
          const c = byUid.get(msg.uid);
          if (!c) continue;
          let body = '';
          try {
            const parsed = await simpleParser(msg.source);
            body = parsed.text || (parsed.html ? htmlToText(parsed.html) : '');
          } catch (e) {
            log(`WARN: could not parse body for ${c.fromAddr} — ${e.message}; classifying on subject only`);
          }
          const cleanBody = stripQuotedAndSignature(body);
          matched++;
          recordReply({
            leadId:    c.lead.leadId,
            sentPath:  c.lead.sentPath,
            brief:     c.lead.brief,
            subject:   c.subject,
            fromEmail: c.fromAddr,
            body:      cleanBody,
            headers:   c.headers,
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  cfg.processed_ids = [...processed].slice(-500); // keep last 500 to avoid unbounded growth
  cfg.last_run      = new Date().toISOString();
  saveConfig(cfg);

  log(`Done — checked: ${found}  matched: ${matched}  skipped (seen): ${skipped}`);
  return { found, matched };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nPoller starting${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log('─'.repeat(50));
  await pollInbox();
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
