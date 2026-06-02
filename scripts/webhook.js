#!/usr/bin/env node
/**
 * Twilio Reply Webhook — listens for inbound SMS, updates lead status automatically
 *
 * Setup (one-time on Mac):
 *   1. npm install ngrok -g   (or use the ngrok desktop app)
 *   2. node scripts/webhook.js        (starts server on WEBHOOK_PORT, default 3000)
 *   3. ngrok http 3000                (exposes it; copy the https URL)
 *   4. Twilio console → Phone Numbers → your number → Messaging →
 *      "A message comes in" → Webhook → paste: https://xxxx.ngrok.io/twilio/reply
 *   5. Leave both terminal tabs running
 *
 * What it does:
 *   - Validates Twilio signature (rejects spoofed requests)
 *   - Matches the sender's phone to a lead in queue/*-brief.json
 *   - STOP/UNSUBSCRIBE/etc → marks lead "unsubscribed"
 *   - Any other reply      → marks lead "positive" (mobile.js auto-replies next run)
 *   - Logs everything to logs/webhook-YYYY-MM-DD.log
 *
 * Reads:  queue/*-brief.json   messages/*-sent.json
 * Writes: messages/*-sent.json  state.json  logs/webhook-*.log
 *
 * Environment variables (from .env.local):
 *   TWILIO_AUTH_TOKEN   — used to validate request signatures
 *   WEBHOOK_PORT        — port to listen on (default: 3000)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const http       = require('http');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const querystring = require('querystring');

const ROOT        = path.join(__dirname, '..');
const QUEUE_DIR   = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STATE_PATH  = path.join(ROOT, 'state.json');
const LOGS_DIR    = path.join(ROOT, 'logs');
const PORT        = parseInt(process.env.WEBHOOK_PORT || '3000', 10);

// Replies that mean "remove me"
const STOP_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  // Strip everything except digits, take last 10
  const digits = (raw || '').replace(/\D/g, '');
  return digits.slice(-10);
}

function log(message) {
  const ts      = new Date().toISOString();
  const dateKey = ts.split('T')[0];
  const line    = `[${ts}] ${message}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, `webhook-${dateKey}.log`), line + '\n');
}

// ── TWILIO SIGNATURE VALIDATION ───────────────────────────────────────────────

function validateTwilioSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  // Sort params alphabetically, concatenate key+value pairs to the URL
  const sortedKeys = Object.keys(params).sort();
  const signing    = url + sortedKeys.map(k => k + params[k]).join('');
  const expected   = crypto.createHmac('sha1', authToken).update(signing).digest('base64');
  const eBuf = Buffer.from(expected);
  const sBuf = Buffer.from(signature);
  if (eBuf.length !== sBuf.length) return false;
  return crypto.timingSafeEqual(eBuf, sBuf);
}

// ── LEAD LOOKUP ───────────────────────────────────────────────────────────────

function findLeadByPhone(fromNormalized) {
  if (!fs.existsSync(QUEUE_DIR)) return null;
  const briefs = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  for (const file of briefs) {
    try {
      const brief  = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      const phone  = normalizePhone(brief.phone);
      if (phone && phone === fromNormalized) {
        const leadId   = file.replace('-brief.json', '');
        const sentPath = path.join(MESSAGES_DIR, `${leadId}-sent.json`);
        return { brief, leadId, sentPath };
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) {
      entry.status = status;
      entry.reply_received_at = new Date().toISOString();
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    }
  } catch (e) {
    log(`WARN: could not update state.json — ${e.message}`);
  }
}

// ── REPLY HANDLER ─────────────────────────────────────────────────────────────

function handleReply(from, body) {
  const fromNorm = normalizePhone(from);
  const bodyTrim = (body || '').trim();
  const isStop   = STOP_KEYWORDS.has(bodyTrim.toLowerCase().split(/\s+/)[0]);

  log(`Inbound SMS from ${from} (normalized: ${fromNorm}): "${bodyTrim}"`);

  const lead = findLeadByPhone(fromNorm);
  if (!lead) {
    log(`No lead found for ${fromNorm} — logged, no action taken`);
    return;
  }

  const { leadId, sentPath, brief } = lead;
  log(`Matched lead: ${brief.business_name} (${leadId})`);

  if (!fs.existsSync(sentPath)) {
    log(`WARN: sent record not found at ${sentPath}`);
    return;
  }

  const sent = JSON.parse(fs.readFileSync(sentPath, 'utf8'));

  if (isStop) {
    sent.status            = 'unsubscribed';
    sent.unsubscribed_at   = new Date().toISOString();
    sent.unsubscribe_reply = bodyTrim;
    fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));
    updateState(leadId, 'unsubscribed');
    log(`Marked ${brief.business_name} as UNSUBSCRIBED`);
  } else {
    sent.status             = 'positive';
    sent.replied_at         = new Date().toISOString();
    sent.reply_text         = bodyTrim;
    sent.reply_channel      = 'sms';
    fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));
    updateState(leadId, 'replied');
    log(`Marked ${brief.business_name} as POSITIVE — run "node scripts/mobile.js" to send booking reply`);
  }
}

// ── HTTP SERVER ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method !== 'POST' || url !== '/twilio/reply') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk.toString(); });

  req.on('end', () => {
    const params    = querystring.parse(rawBody);
    const signature = req.headers['x-twilio-signature'] || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    // Build the full URL Twilio signed (protocol + host + path)
    const protocol  = req.headers['x-forwarded-proto'] || 'https';
    const host      = req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${PORT}`;
    const fullUrl   = `${protocol}://${host}/twilio/reply`;

    const valid = validateTwilioSignature(authToken, signature, fullUrl, params);
    if (!valid) {
      log(`WARN: Invalid Twilio signature from ${req.socket.remoteAddress} — request rejected`);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const from = params.From || '';
    const body = params.Body || '';

    try {
      handleReply(from, body);
    } catch (e) {
      log(`ERROR processing reply: ${e.message}`);
    }

    // Twilio expects a 200 with TwiML — empty response means no auto-reply
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('━'.repeat(50));
  console.log('  Trevo Advisors — Twilio Reply Webhook');
  console.log('━'.repeat(50));
  console.log(`  Listening on port ${PORT}`);
  console.log(`  Endpoint: POST /twilio/reply`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Run: ngrok http ' + PORT);
  console.log('    2. Copy the https://xxxx.ngrok.io URL');
  console.log('    3. Paste into Twilio console:');
  console.log('       Phone Numbers → your number → Messaging →');
  console.log('       "A message comes in" → Webhook → https://xxxx.ngrok.io/twilio/reply');
  console.log('');
  console.log('  Logs: logs/webhook-YYYY-MM-DD.log');
  console.log('━'.repeat(50));
  console.log('');
});

server.on('error', (err) => {
  console.error(`Server error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set WEBHOOK_PORT= in .env.local to use a different port.`);
  }
  process.exit(1);
});
