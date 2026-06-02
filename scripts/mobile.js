#!/usr/bin/env node
'use strict';

const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const { recordReply } = require('./template-picker');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const ROOT         = path.resolve(__dirname, '..');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const STATE_PATH   = path.join(ROOT, 'state.json');
const LOGS_DIR     = path.join(ROOT, 'logs');

// ── HELPERS ───────────────────────────────────────────────────────────────────

function ensureDirs() {
  [MESSAGES_DIR, QUEUE_DIR, LOGS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function log(msg) {
  const dateStr = new Date().toISOString().split('T')[0];
  const line    = `[${new Date().toISOString()}] [mobile] ${msg}`;
  fs.appendFileSync(path.join(LOGS_DIR, `${dateStr}.log`), line + '\n');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { queue: [], active: [], closed: [], nora_pipeline: [], daily_stats: {} }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── FIND POSITIVE REPLIES ─────────────────────────────────────────────────────

function findPositiveReplies() {
  if (!fs.existsSync(MESSAGES_DIR)) return [];
  return fs.readdirSync(MESSAGES_DIR)
    .filter(f => f.endsWith('-sent.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(r => r && r.status === 'positive');
}

// ── LOAD BRIEF ────────────────────────────────────────────────────────────────

function loadBrief(leadId) {
  const p = path.join(QUEUE_DIR, `${leadId}-brief.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

// ── NEXT AVAILABLE SLOTS (spread across next 2 weeks, varied times) ─────────────

function nextSlots() {
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TIMES  = ['10am', '2pm', '4pm'];
  const slots  = [];
  const d      = new Date();
  d.setDate(d.getDate() + 1);
  let timeIdx  = 0;

  // Pick one slot per week for 2 weeks — prefer Mon/Wed/Thu
  const PREFERRED = [1, 3, 4]; // Mon, Wed, Thu
  let week = 0;

  while (slots.length < 4 && week < 14) {
    if (PREFERRED.includes(d.getDay())) {
      slots.push(`${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()} at ${TIMES[timeIdx % TIMES.length]}`);
      timeIdx++;
      d.setDate(d.getDate() + 2); // skip ahead to avoid back-to-back
    } else {
      d.setDate(d.getDate() + 1);
    }
    week++;
  }
  return slots;
}

// ── BUILD DRAFT RESPONSE ──────────────────────────────────────────────────────

function buildDraft(record, slots, calLink) {
  const startLink = process.env.SITE_START_URL || 'https://trevoadvisors.com/start/';
  const calPart   = calLink ? `\n\nOr book directly: ${calLink}` : '';
  const options   = slots.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Hey! Great to hear from you. I'd love to show you the full mockup on a quick call — only takes 15 min.\n\nHere are a few times:\n${options}\n\nJust reply with a number. Or if you're ready to move forward now, you can get started here: ${startLink}${calPart}`;
}

// ── AUTO-SEND LOG ─────────────────────────────────────────────────────────────

function printSentSummary(record, draft, calLink) {
  const latestReply = record.replies?.slice(-1)[0]?.text
    || record.latest_reply
    || '(see messages file)';

  console.log('\n' + '═'.repeat(56));
  console.log('AUTO-SENT REPLY');
  console.log('─'.repeat(56));
  console.log(`Business : ${record.business_name}`);
  console.log(`Trade    : ${record.trade} | City: ${record.city}`);
  console.log(`Channel  : ${record.channel}`);
  console.log(`Their reply: "${latestReply}"`);
  console.log('─'.repeat(56));
  console.log('SENT:\n');
  console.log(draft);
  if (calLink) console.log(`\nCal.com  : ${calLink}`);
  console.log('═'.repeat(56));
}

// ── SEND HELPERS ──────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function sendSms(phone, message) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_PHONE;
  if (!sid || !token || !from) throw new Error('Twilio env vars not set in .env.local');

  const payload = new URLSearchParams({ From: from, To: phone, Body: message }).toString();
  const auth    = Buffer.from(`${sid}:${token}`).toString('base64');
  const options = {
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
    method:   'POST',
    headers:  {
      'Authorization':  `Basic ${auth}`,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const attempt = () => new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve({ sid: parsed.sid })
            : (() => { const e = new Error(`Twilio ${res.statusCode}: ${data}`); e.statusCode = res.statusCode; reject(e); })();
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  return attempt().catch(async err => {
    if (err.statusCode === 429 || err.statusCode >= 500) { await delay(2000); return attempt(); }
    throw err;
  });
}

function sendEmail(toEmail, businessName, message) {
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'outreach@yourdomain.com';
  const fromName  = process.env.FROM_NAME  || 'Your Name';
  if (!apiKey) throw new Error('RESEND_API_KEY not set in .env.local');

  const payload = JSON.stringify({
    from:    `${fromName} <${fromEmail}>`,
    to:      [toEmail],
    subject: `Re: ${businessName}'s website`,
    text:    message
  });

  const options = {
    hostname: 'api.resend.com',
    path:     '/emails',
    method:   'POST',
    headers:  {
      'Authorization':  `Bearer ${apiKey}`,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const attempt = () => new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve({ id: parsed.id })
            : (() => { const e = new Error(`Resend ${res.statusCode}: ${data}`); e.statusCode = res.statusCode; reject(e); })();
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  return attempt().catch(async err => {
    if (err.statusCode === 429 || err.statusCode >= 500) { await delay(2000); return attempt(); }
    throw err;
  });
}

// ── SEND DISPATCH ─────────────────────────────────────────────────────────────

async function sendReply(record, message) {
  const channel = record.channel;
  if (channel === 'sms' && record.phone) {
    const result = await sendSms(record.phone, message);
    return { method: 'sms', ref: result.sid };
  }
  if (channel === 'email' && record.email) {
    const result = await sendEmail(record.email, record.business_name, message);
    return { method: 'email', ref: result.id };
  }
  // Manual fallback for ig_dm, linkedin, or missing contact
  const draftPath = path.join(MESSAGES_DIR, `${record.lead_id}-reply-draft.txt`);
  fs.writeFileSync(draftPath, message);
  return { method: 'manual', ref: draftPath };
}

// ── NORA UPSELL CHECK ─────────────────────────────────────────────────────────

async function checkNoraPipeline() {
  const state = loadState();
  const today = new Date().toISOString().split('T')[0];
  const due   = (state.nora_pipeline || []).filter(e => e.nora_pitch_due === today && !e.nora_pitched);

  if (due.length === 0) return;

  console.log(`\n── NORA UPSELL (${due.length} due today) ──────────────────────`);

  for (const entry of due) {
    let record = null;
    try { record = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${entry.lead_id}-sent.json`), 'utf8')); }
    catch { console.warn(`  Could not load record for ${entry.lead_id} — skipping`); continue; }

    const calLink2  = process.env.CALCOM_LINK || null;
    const calPart2  = calLink2 ? ` Book here: ${calLink2}` : ' Just reply and we\'ll set up a quick call.';
    const pitch = `Hey! It's been a week since your site went live — hope it's already bringing in calls.\n\nQuick thought: we offer Nora, a 24/7 AI phone agent that answers calls, books jobs, and follows up with leads automatically. Our clients bundle it with hosting for $350/mo.\n\nWorth a 10-min chat to see if it fits?${calPart2}`;

    console.log('\n' + '═'.repeat(56));
    console.log('NORA UPSELL PITCH');
    console.log('─'.repeat(56));
    console.log(`Business : ${record.business_name} (${record.city})`);
    console.log(`Channel  : ${record.channel}`);
    console.log('─'.repeat(56));
    console.log(pitch);
    console.log('═'.repeat(56));

    try {
      const result = await sendReply(record, pitch);
      if (result.method === 'manual') {
        console.log(`  📋 Nora pitch draft → ${path.basename(result.ref)}`);
        console.log(`  Send manually via ${record.channel}`);
      } else {
        console.log(`  ✓ Nora pitch sent via ${result.method} (ref: ${result.ref})`);
      }
      log(`Nora pitch sent to ${record.business_name} (${entry.lead_id}) via ${result.method}`);

      entry.nora_pitched    = true;
      entry.nora_pitched_at = new Date().toISOString();
      saveState(state);
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      log(`Nora pitch error for ${record.business_name}: ${err.message}`);
    }
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nMobile Agent starting');
  console.log('─'.repeat(50));

  ensureDirs();

  await checkNoraPipeline();

  const replies = findPositiveReplies();

  if (replies.length === 0) {
    console.log('\nNo positive replies found in /messages/.');
    console.log('To mark a reply as positive, set "status": "positive" in messages/{lead_id}-sent.json');
    process.exit(0);
  }

  console.log(`\nFound ${replies.length} positive reply(ies) to handle.\n`);
  log(`Processing ${replies.length} positive replies`);

  const calLink = process.env.CALCOM_LINK || null;

  for (const record of replies) {
    const slots   = nextSlots();
    const message = buildDraft(record, slots, calLink);
    printSentSummary(record, message, calLink);

    try {
      const result = await sendReply(record, message);
      if (result.method === 'manual') {
        console.log(`  📋 Reply draft → ${path.basename(result.ref)}`);
        console.log(`  Send this manually via ${record.channel}`);
      } else {
        console.log(`  ✓ Sent via ${result.method} (ref: ${result.ref})`);
      }
      log(`Reply sent to ${record.business_name} (${record.lead_id}) via ${result.method}`);

      record.status      = 'call_booked';
      record.booked_at   = new Date().toISOString();
      record.booking_msg = message;
      if (record.template_id) recordReply(record.channel, record.template_id);
      fs.writeFileSync(
        path.join(MESSAGES_DIR, `${record.lead_id}-sent.json`),
        JSON.stringify(record, null, 2)
      );

      const state = loadState();
      const entry = state.queue.find(l => l.lead_id === record.lead_id);
      if (entry) {
        entry.status    = 'hot';
        entry.booked_at = record.booked_at;
      } else {
        (state.active = state.active || []).push({
          lead_id:  record.lead_id,
          status:   'hot',
          booked_at: record.booked_at
        });
      }
      saveState(state);

    } catch (err) {
      console.error(`  Error sending reply: ${err.message}`);
      log(`Reply send error for ${record.business_name}: ${err.message}`);
    }
  }

  console.log('\nMobile Agent done.\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
