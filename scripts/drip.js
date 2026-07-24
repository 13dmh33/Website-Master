#!/usr/bin/env node
/**
 * Drip — automated follow-up sequence for non-responders
 *
 * Sequence (days from initial send):
 *   Day 4  → d1  (soft check-in)
 *   Day 8  → d1b (missed call angle)
 *   Day 12 → d1c (competitor visibility)
 *   Day 19 → d2  (final touch / breakup)
 *   Day 26 → mark unresponsive
 *
 * Usage:
 *   node scripts/drip.js --force
 *   node scripts/drip.js --dry-run --force
 *   node scripts/drip.js --step d1 --force    (one step only)
 *   node scripts/drip.js --channel email --force   (email follow-ups only, skip SMS)
 *
 * Reads:  messages/*-sent.json   queue/*-brief.json
 *         config/drip-config.json  config/templates.json
 * Writes: messages/*-sent.json   state.json   config/drip-config.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const twilio     = require('twilio');
const { writeLog }             = require('./logger');
const { recordTwilio, recordEmail } = require('./cost-tracker');
const { isSuppressed }         = require('./lib/suppression');
const { appendFooter, assertEmailCompliant } = require('./lib/compliance');

const ROOT           = path.join(__dirname, '..');
const CONFIG_PATH    = path.join(ROOT, 'config', 'drip-config.json');
const STATE_PATH     = path.join(ROOT, 'state.json');
const MESSAGES_DIR   = path.join(ROOT, 'messages');
const QUEUE_DIR      = path.join(ROOT, 'queue');
const TEMPLATES_PATH = path.join(ROOT, 'config', 'templates.json');

const args       = process.argv.slice(2);
const hasFlag    = (f) => args.includes(f);
const getArg     = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const isDryRun   = hasFlag('--dry-run');
const stepFilter = getArg('--step');
const channelFilter = getArg('--channel'); // 'email' or 'sms' — restrict follow-ups to one channel

const STEPS = ['d1', 'd1b', 'd1c', 'd2'];

// ── CONFIG ─────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      enabled: true, auto_run: false,
      d1_delay_days: 4, d1b_delay_days: 8, d1c_delay_days: 12, d2_delay_days: 19,
      dead_after_days: 26, daily_limit: 20,
      email_stagger_min_s: 120, email_stagger_max_s: 300,
      sms_stagger_min_s: 20,   sms_stagger_max_s: 60,
      today: today(), sent_today: 0, last_run: null
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }

function checkAutoRun(cfg) {
  if (hasFlag('--force')) return;
  if (!cfg.auto_run) {
    console.log('Drip is in manual mode. Run with --force, or --dry-run --force to preview.');
    process.exit(0);
  }
}

function checkLimits(cfg) {
  if (cfg.today !== today()) { cfg.today = today(); cfg.sent_today = 0; }
  if (cfg.sent_today >= cfg.daily_limit) {
    console.error(`DAILY LIMIT: ${cfg.sent_today}/${cfg.daily_limit} drip messages sent today.`);
    process.exit(1);
  }
  return cfg.daily_limit - cfg.sent_today;
}

// ── TEMPLATES ──────────────────────────────────────────────────────────────────

function loadDripTemplates() {
  return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8')).drip || {};
}

function scheduleLink() {
  return process.env.CALCOM_LINK || process.env.SITE_START_URL || 'https://trevoadvisors.com/start/';
}

function cleanBusinessName(name) {
  if (!name) return '';
  let clean = name.split('|')[0].trim();
  if (clean.length > 40) clean = clean.slice(0, 37).trimEnd() + '…';
  return clean;
}

function fill(text, lead) {
  const cityDisplay = (lead.city || '').replace(/,\s*[A-Z]{2}$/, '');
  return text
    .replace(/\[Business Name\]/g,   cleanBusinessName(lead.business_name))
    .replace(/\[City\]/g,            cityDisplay)
    .replace(/\[trade\]/g,           lead.trade          || '')
    .replace(/\[Schedule Link\]/g,   scheduleLink());
}

// ── QUEUE BUILDER ──────────────────────────────────────────────────────────────

function daysSince(iso) {
  if (!iso) return -1;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

function loadDripQueue(cfg, templates) {
  const delays = {
    d1: cfg.d1_delay_days, d1b: cfg.d1b_delay_days,
    d1c: cfg.d1c_delay_days, d2: cfg.d2_delay_days
  };

  if (!fs.existsSync(MESSAGES_DIR)) return [];
  const files = fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json'));
  const queue = [];

  for (const file of files) {
    try {
      const sentPath = path.join(MESSAGES_DIR, file);
      const sent     = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
      const leadId   = file.replace('-sent.json', '');

      if (sent.status === 'positive' || sent.status === 'unresponsive') continue;
      if (sent.status === 'unsubscribed' || isSuppressed(leadId)) continue; // do-not-contact — hard gate

      const briefPath = path.join(QUEUE_DIR, `${leadId}-brief.json`);
      if (!fs.existsSync(briefPath)) continue;
      const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));

      const drip = sent.drip || {};

      const channels = channelFilter ? [channelFilter] : ['email', 'sms'];
      for (const channel of channels) {
        const initialSentAt = channel === 'email' ? sent.email_sent_at : sent.sms_sent_at;
        if (!initialSentAt) continue;

        const days = daysSince(initialSentAt);
        const stepsToCheck = stepFilter ? [stepFilter] : STEPS;

        for (const step of stepsToCheck) {
          const delay       = delays[step];
          if (delay === undefined) continue;
          const alreadySent = drip[step]?.[`${channel}_sent_at`];
          if (alreadySent) continue;
          if (days < delay) break; // not yet due — don't skip ahead

          const tmpl = templates[step]?.[channel];
          if (!tmpl) break;

          const to = channel === 'email' ? brief.email : brief.phone;
          if (!to) break;

          queue.push({ sentPath, sent, brief, leadId, channel, step, tmpl, to });
          break; // one step per channel per run
        }
      }
    } catch (e) {
      console.warn(`Skipping ${file}: ${e.message}`);
    }
  }

  return queue;
}

// ── UNRESPONSIVE SWEEP ─────────────────────────────────────────────────────────

function markUnresponsive(cfg) {
  if (!fs.existsSync(MESSAGES_DIR)) return 0;
  const files = fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json'));
  let marked = 0;

  for (const file of files) {
    try {
      const sentPath = path.join(MESSAGES_DIR, file);
      const sent     = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
      const leadId   = file.replace('-sent.json', '');
      if (sent.status === 'positive' || sent.status === 'unresponsive') continue;
      if (sent.status === 'unsubscribed' || isSuppressed(leadId)) continue; // never reclassify an opt-out

      const initialSentAt = sent.email_sent_at || sent.sms_sent_at;
      if (!initialSentAt || daysSince(initialSentAt) < cfg.dead_after_days) continue;

      const drip = sent.drip || {};
      const emailDone = !sent.email_sent_at || drip.d2?.email_sent_at;
      const smsDone   = !sent.sms_sent_at   || drip.d2?.sms_sent_at;
      if (!emailDone || !smsDone) continue;

      sent.status = 'unresponsive';
      sent.marked_unresponsive_at = new Date().toISOString();
      fs.writeFileSync(sentPath, JSON.stringify(sent, null, 2));
      updateState(file.replace('-sent.json', ''), 'unresponsive');
      marked++;
    } catch { /* ignore */ }
  }
  return marked;
}

// ── STATE ──────────────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const entry = state.queue.find(l => l.lead_id === leadId);
  if (entry) { entry.status = status; entry.drip_updated_at = new Date().toISOString(); }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── SENDERS ────────────────────────────────────────────────────────────────────

let _transport = null;
function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user: process.env.ZOHO_EMAIL, pass: process.env.ZOHO_APP_PASSWORD }
  });
  return _transport;
}

async function sendEmail(to, subject, body, cfg) {
  assertEmailCompliant(); // CAN-SPAM hard gate — same as pitcher.js
  return getTransport().sendMail({
    from: `"${cfg.from_name || 'Dave'}" <${process.env.ZOHO_EMAIL}>`,
    to, subject, text: appendFooter(body)
  });
}

async function sendSms(to, body) {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    .messages.create({ body, from: process.env.TWILIO_FROM_PHONE, to });
}

function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── MAIN ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nDrip starting${isDryRun ? ' [DRY RUN]' : ''}${stepFilter ? ` [step: ${stepFilter}]` : ''}${channelFilter ? ` [channel: ${channelFilter}]` : ''}`);
  console.log('─'.repeat(50));

  const cfg       = loadConfig();
  checkAutoRun(cfg);
  const remaining = checkLimits(cfg);
  const templates = loadDripTemplates();

  if (!cfg.enabled) {
    console.log('Drip disabled (enabled: false in drip-config.json).');
    process.exit(0);
  }

  const queue  = loadDripQueue(cfg, templates);
  const toSend = queue.slice(0, remaining);

  if (toSend.length === 0) {
    console.log('No drip messages due.');
    const unresponsive = markUnresponsive(cfg);
    if (unresponsive > 0) console.log(`Marked ${unresponsive} leads unresponsive.`);
    process.exit(0);
  }

  console.log(`Due: ${queue.length} | Sending: ${toSend.length} | Daily limit: ${cfg.daily_limit}`);
  console.log(`Sent today: ${cfg.sent_today}\n`);

  let sent = 0, errors = 0;

  for (let i = 0; i < toSend.length; i++) {
    const { sentPath, sent: sentRecord, brief, leadId, channel, step, tmpl, to } = toSend[i];
    const label = `[${i + 1}/${toSend.length}] ${brief.business_name} (${step} / ${channel})`;

    const body    = fill(tmpl.body, brief);
    const subject = tmpl.subject ? fill(tmpl.subject, brief) : null;

    if (isDryRun) {
      console.log(`${label} — DRY RUN`);
      console.log(`  To:      ${to}`);
      if (subject) console.log(`  Subject: ${subject}`);
      console.log(`  Message: ${body.substring(0, 100)}...`);
      console.log();
      continue;
    }

    try {
      if (channel === 'email') {
        await sendEmail(to, subject, body, cfg);
        recordEmail(1, 'drip');
      } else {
        await sendSms(to, body);
        recordTwilio(1, 'drip');
      }

      // Update sent record
      if (!sentRecord.drip) sentRecord.drip = {};
      if (!sentRecord.drip[step]) sentRecord.drip[step] = {};
      sentRecord.drip[step][`${channel}_sent_at`] = new Date().toISOString();
      fs.writeFileSync(sentPath, JSON.stringify(sentRecord, null, 2));
      updateState(leadId, `drip_${step}_sent`);

      cfg.sent_today++;
      saveConfig(cfg);
      console.log(`${label} — ✓ sent`);
      sent++;

      if (i < toSend.length - 1) {
        const ms = channel === 'email'
          ? randomBetween(cfg.email_stagger_min_s, cfg.email_stagger_max_s) * 1000
          : randomBetween(cfg.sms_stagger_min_s,   cfg.sms_stagger_max_s)   * 1000;
        await sleep(ms);
      }
    } catch (err) {
      console.log(`${label} — ✗ ERROR: ${err.message}`);
      errors++;
    }
  }

  const unresponsive = markUnresponsive(cfg);

  cfg.last_run = new Date().toISOString();
  saveConfig(cfg);

  writeLog('drip', [
    `sent: ${sent}  errors: ${errors}  unresponsive: ${unresponsive}`,
    `daily: ${cfg.sent_today} / ${cfg.daily_limit}`
  ]);

  console.log('\n' + '─'.repeat(50));
  console.log(`Done.`);
  console.log(`  Sent:         ${sent}`);
  console.log(`  Errors:       ${errors}`);
  console.log(`  Unresponsive: ${unresponsive}`);
  console.log(`  Sent today:   ${cfg.sent_today} / ${cfg.daily_limit}`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
