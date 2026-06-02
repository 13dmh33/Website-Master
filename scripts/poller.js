#!/usr/bin/env node
/**
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

const ROOT         = path.join(__dirname, '..');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STATE_PATH   = path.join(ROOT, 'state.json');
const LOGS_DIR     = path.join(ROOT, 'logs');
const CONFIG_PATH  = path.join(ROOT, 'config', 'poller-config.json');

const isDryRun = process.argv.includes('--dry-run');

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

function updateState(leadId, status) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) {
      entry.status           = status;
      entry.reply_received_at = new Date().toISOString();
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    }
  } catch (e) {
    log(`WARN: could not update state.json — ${e.message}`);
  }
}

function markPositive(leadId, sentPath, brief, subject, fromEmail) {
  if (isDryRun) {
    log(`DRY RUN — would mark ${brief.business_name} as positive (reply from ${fromEmail})`);
    return;
  }
  if (!fs.existsSync(sentPath)) {
    log(`WARN: sent record not found at ${sentPath}`);
    return;
  }
  const sent = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
  if (sent.status === 'positive' || sent.status === 'unsubscribed') {
    log(`${brief.business_name} already has status "${sent.status}" — skipping`);
    return;
  }
  sent.status         = 'positive';
  sent.replied_at     = new Date().toISOString();
  sent.reply_subject  = subject;
  sent.reply_channel  = 'email';
  sent.reply_from     = fromEmail;
  fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));
  updateState(leadId, 'replied');
  log(`✓ Marked ${brief.business_name} as POSITIVE — run "node scripts/mobile.js" to send booking reply`);
}

// ── IMAP POLL ─────────────────────────────────────────────────────────────────

async function pollInbox() {
  let ImapFlow;
  try {
    ({ ImapFlow } = require('imapflow'));
  } catch {
    console.error('\n✗ imapflow not installed. Run:\n  npm install imapflow\nthen retry.\n');
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

        matched++;
        markPositive(lead.leadId, lead.sentPath, lead.brief, subject, fromAddr);
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
