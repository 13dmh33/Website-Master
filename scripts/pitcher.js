#!/usr/bin/env node
/**
 * Pitcher — sends approved cold messages via email (Zoho SMTP) or SMS (Twilio)
 *
 * Usage:
 *   node scripts/pitcher.js --force
 *   node scripts/pitcher.js --limit 10 --force
 *   node scripts/pitcher.js --dry-run --force   (preview messages, send nothing)
 *
 * Reads:  queue/*-brief.json     (checker_approved = true, status != sent)
 *         mockups/*-video.txt    (video URL if available — attached to email)
 *         config/pitcher-config.json
 *         .env.local             (ZOHO_EMAIL, ZOHO_APP_PASSWORD, TWILIO_*)
 * Writes: messages/{lead_id}-sent.json
 *         state.json             (status: checked → sent)
 *         config/pitcher-config.json (daily count tracking)
 *
 * Channel routing (set by Diagnoser, verified here):
 *   email  → plumbers, HVAC  (via Zoho SMTP — dave@trevoadvisors.com)
 *   sms    → electricians, roofers  (via Twilio)
 *   ig_dm  → flagged as manual_send (no API — written to messages/ as draft)
 *   linkedin → flagged as manual_send
 *
 * Stagger: random delay between sends to avoid spam filters.
 *   Email: email_stagger_min_s – email_stagger_max_s (default 120–300s)
 *   SMS:   sms_stagger_min_s  – sms_stagger_max_s   (default 20–60s)
 *   Configurable in config/pitcher-config.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs          = require('fs');
const path        = require('path');
const https       = require('https');
const nodemailer  = require('nodemailer');
const { writeLog }    = require('./logger');
const { recordSent }  = require('./template-picker');
const { recordTwilio } = require('./cost-tracker');

// ── PATHS ─────────────────────────────────────────────────────────────────────

const ROOT          = path.join(__dirname, '..');
const CONFIG_PATH   = path.join(ROOT, 'config', 'pitcher-config.json');
const STATE_PATH    = path.join(ROOT, 'state.json');
const QUEUE_DIR     = path.join(ROOT, 'queue');
const MESSAGES_DIR  = path.join(ROOT, 'messages');
const MOCKUPS_DIR   = path.join(ROOT, 'mockups');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);
const limitArg  = parseInt(getArg('--limit') || '0', 10);
const isDryRun  = hasFlag('--dry-run');

// ── CONFIG ────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }
function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      daily_limit: 30,
      auto_run: false,
      from_email: 'dave@trevoadvisors.com',
      from_name: 'Dave',
      email_stagger_min_s: 120,
      email_stagger_max_s: 300,
      sms_stagger_min_s: 20,
      sms_stagger_max_s: 60,
      current_month: currentMonth(),
      today: today(),
      sent_today: 0,
      sent_this_month: 0,
      total_sent: 0,
      last_run: null
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // backfill stagger defaults if missing
  cfg.email_stagger_min_s = cfg.email_stagger_min_s ?? 120;
  cfg.email_stagger_max_s = cfg.email_stagger_max_s ?? 300;
  cfg.sms_stagger_min_s   = cfg.sms_stagger_min_s   ?? 20;
  cfg.sms_stagger_max_s   = cfg.sms_stagger_max_s   ?? 60;
  return cfg;
}

function checkAutoRun(config) {
  if (hasFlag('--force')) return;
  if (!config.auto_run) {
    console.log('Pitcher is in manual mode (auto_run = false).');
    console.log('Run with --force to send, or --dry-run --force to preview.');
    process.exit(0);
  }
}

function checkLimits(config) {
  if (config.today !== today()) { config.today = today(); config.sent_today = 0; }
  if (config.current_month !== currentMonth()) {
    config.current_month = currentMonth();
    config.sent_this_month = 0;
  }

  if (config.sent_today >= config.daily_limit) {
    console.error(`DAILY LIMIT: ${config.sent_today}/${config.daily_limit} already sent today.`);
    process.exit(1);
  }

  let effective = config.daily_limit - config.sent_today;
  if (limitArg > 0) effective = Math.min(effective, limitArg);
  return effective;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── STARTUP GUARDS ────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(MOCKUPS_DIR,  { recursive: true });
}

function warnIfMissingCreds() {
  if (!process.env.ZOHO_EMAIL || !process.env.ZOHO_APP_PASSWORD) {
    console.warn('⚠  WARNING: ZOHO_EMAIL or ZOHO_APP_PASSWORD not set in .env.local');
    console.warn('   Email sends will fail. Set both before running live.\n');
  }
}

// ── LOAD APPROVED BRIEFS ──────────────────────────────────────────────────────

function loadApprovedBriefs() {
  // Build set of already-sent lead IDs from messages/
  const sentIds = new Set(
    fs.readdirSync(MESSAGES_DIR)
      .filter(f => f.endsWith('-sent.json'))
      .map(f => f.replace('-sent.json', ''))
  );

  const files  = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  const briefs = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      if (data.checker_approved && !sentIds.has(data.lead_id)) {
        briefs.push(data);
      }
    } catch (e) {
      console.warn(`Could not read ${file}: ${e.message}`);
    }
  }

  // Priority first, then by gap_score
  return briefs.sort((a, b) => {
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    return (b.gap_score || 0) - (a.gap_score || 0);
  });
}

// ── VIDEO URL HELPER ──────────────────────────────────────────────────────────

function getVideoUrl(leadId) {
  const videoPath = path.join(MOCKUPS_DIR, `${leadId}-video.txt`);
  if (!fs.existsSync(videoPath)) return null;
  const url = fs.readFileSync(videoPath, 'utf8').trim();
  return url && url !== 'pending_manual' ? url : null;
}

// ── RETRY HELPER ─────────────────────────────────────────────────────────────

function isRetryable(statusCode) {
  return statusCode === 429 || statusCode >= 500;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── EMAIL SENDER (Zoho SMTP) ──────────────────────────────────────────────────

let _zohoTransport = null;

function getZohoTransport() {
  if (_zohoTransport) return _zohoTransport;
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local');
  _zohoTransport = nodemailer.createTransport({
    host:   'smtp.zoho.com',
    port:   465,
    secure: true,
    auth:   { user, pass }
  });
  return _zohoTransport;
}

async function sendEmail(brief, config, videoUrl) {
  const transport = getZohoTransport();
  const subject   = `Quick question about ${brief.business_name}'s website`;
  const ps        = videoUrl
    ? `\n\nP.S. Built a quick mockup of what a new site could look like: ${videoUrl}`
    : `\n\nP.S. I put together a quick mockup of what a new site could look like — happy to share it on a call.`;
  const text = `${brief.final_message}${ps}`;

  const info = await transport.sendMail({
    from:    `${config.from_name} <${config.from_email}>`,
    to:      brief.email,
    subject,
    text
  });

  return { id: info.messageId, subject, body: text };
}

// ── STAGGER DELAY ─────────────────────────────────────────────────────────────

async function staggerDelay(minS, maxS) {
  const seconds = minS + Math.floor(Math.random() * (maxS - minS + 1));
  const mins    = Math.floor(seconds / 60);
  const secs    = seconds % 60;
  const label   = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  process.stdout.write(`  ⏱  Staggering ${label} before next send`);
  const tick = Math.ceil(seconds / 20);
  for (let i = 0; i < seconds; i += tick) {
    await delay(Math.min(tick, seconds - i) * 1000);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}

// ── SMS SENDER (Twilio) ───────────────────────────────────────────────────────

function sendSms(brief, videoUrl) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_PHONE;

  if (!sid || !token || !from) {
    return Promise.reject(new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_PHONE not set in .env.local'));
  }

  const body = videoUrl
    ? `${brief.final_message}\n\nMockup: ${videoUrl}`
    : brief.final_message;

  const payload = new URLSearchParams({
    From: from,
    To:   brief.phone,
    Body: body
  }).toString();

  const auth    = Buffer.from(`${sid}:${token}`).toString('base64');
  const options = {
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${sid}/Messages.json`,
    method:   'POST',
    headers:  {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const attempt = () => new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ sid: parsed.sid, body });
          } else {
            const err = new Error(`Twilio error ${res.statusCode}: ${data}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  return attempt().catch(async (err) => {
    if (isRetryable(err.statusCode)) {
      console.warn(`  Twilio ${err.statusCode} — retrying in 2s…`);
      await delay(2000);
      return attempt();
    }
    throw err;
  });
}

// ── MANUAL DRAFT (IG DM / LinkedIn) ──────────────────────────────────────────

function writeManualDraft(brief, videoUrl) {
  const draft = {
    lead_id:       brief.lead_id,
    business_name: brief.business_name,
    channel:       brief.channel,
    message:       brief.final_message,
    video_url:     videoUrl || null,
    instructions:  `Send this manually via ${brief.channel === 'ig_dm' ? 'Instagram DM' : 'LinkedIn'}. After sending, update status to "sent" in messages/${brief.lead_id}-sent.json.`,
    created_at:    new Date().toISOString()
  };

  const draftPath = path.join(MESSAGES_DIR, `${brief.lead_id}-draft.txt`);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
  return draft;
}

// ── LOG SEND ──────────────────────────────────────────────────────────────────

function logSend(brief, result, channel, videoUrl, status = 'sent') {
  const record = {
    lead_id:       brief.lead_id,
    business_name: brief.business_name,
    trade:         brief.trade,
    city:          brief.city,
    phone:         brief.phone || null,
    email:         brief.email || null,
    channel,
    template_id:   brief.template_id   || null,
    template_name: brief.template_name || null,
    sent_at:       new Date().toISOString(),
    subject:       result.subject || null,
    body:          result.body || brief.final_message,
    video_url:     videoUrl || null,
    status,
    replies:       []
  };

  fs.writeFileSync(
    path.join(MESSAGES_DIR, `${brief.lead_id}-sent.json`),
    JSON.stringify(record, null, 2)
  );
}

function updateState(leadId, status) {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) {
      entry.status  = status;
      entry.sent_at = new Date().toISOString();
    } else {
      console.warn(`  state.json: no queue entry found for ${leadId} — skipping state update`);
    }
    state.daily_stats = state.daily_stats || {};
    state.daily_stats.messages_sent = (state.daily_stats.messages_sent || 0) + 1;
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn(`  Could not update state.json for ${leadId}: ${e.message}`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nPitcher starting${isDryRun ? ' [DRY RUN — nothing will be sent]' : ''}`);
  console.log('─'.repeat(50));

  ensureDirs();
  const config = loadConfig();
  checkAutoRun(config);
  warnIfMissingCreds();
  const effectiveLimit = checkLimits(config);

  const briefs = loadApprovedBriefs();
  if (briefs.length === 0) {
    console.log('No approved briefs ready to send. Run Checker first.');
    process.exit(0);
  }

  const toSend = briefs.slice(0, effectiveLimit);
  console.log(`Approved briefs: ${briefs.length} | Sending: ${toSend.length} | Daily limit: ${config.daily_limit}`);
  console.log(`Sent today: ${config.sent_today} | This month: ${config.sent_this_month}\n`);

  let sent = 0, manual = 0, errors = 0;

  for (let i = 0; i < toSend.length; i++) {
    const brief    = toSend[i];
    const videoUrl = getVideoUrl(brief.lead_id);
    const label    = `[${i + 1}/${toSend.length}] ${brief.business_name} (${brief.channel})`;
    const channel  = brief.channel || 'email';

    if (isDryRun) {
      console.log(`${label} — DRY RUN`);
      console.log(`  To:      ${brief.phone || brief.email || 'no contact info'}`);
      console.log(`  Message: ${brief.final_message?.substring(0, 80)}...`);
      console.log(`  Video:   ${videoUrl || 'none'}`);
      continue;
    }

    try {
      if (channel === 'email') {
        if (!brief.email) {
          console.log(`${label} — skipped (no email address on lead)`);
          continue;
        }
        const result = await sendEmail(brief, config, videoUrl);
        logSend(brief, result, channel, videoUrl);
        updateState(brief.lead_id, 'sent');
        if (brief.template_id) recordSent(channel, brief.template_id);
        config.sent_today++;
        config.sent_this_month++;
        config.total_sent++;
        saveConfig(config);
        sent++;
        console.log(`${label} — ✓ sent via Zoho (id: ${result.id}${brief.template_id ? ', tmpl: ' + brief.template_id : ''})`);

      } else if (channel === 'sms') {
        if (!brief.phone) {
          console.log(`${label} — skipped (no phone number on lead)`);
          continue;
        }
        const result = await sendSms(brief, videoUrl);
        logSend(brief, result, channel, videoUrl);
        updateState(brief.lead_id, 'sent');
        if (brief.template_id) recordSent(channel, brief.template_id);
        recordTwilio(1);
        config.sent_today++;
        config.sent_this_month++;
        config.total_sent++;
        saveConfig(config);
        sent++;
        console.log(`${label} — ✓ sent (Twilio sid: ${result.sid}${brief.template_id ? ', tmpl: ' + brief.template_id : ''})`);

      } else {
        // ig_dm or linkedin — write manual draft
        const draft = writeManualDraft(brief, videoUrl);
        logSend(brief, draft, channel, videoUrl, 'manual_pending');
        updateState(brief.lead_id, 'manual_pending');
        manual++;
        console.log(`${label} — 📋 manual draft written to messages/${brief.lead_id}-draft.txt`);
      }

    } catch (err) {
      console.log(`${label} — ✗ ERROR: ${err.message}`);
      errors++;
    }

    if (i < toSend.length - 1 && !isDryRun) {
      const isEmail = (brief.channel || 'email') === 'email';
      await staggerDelay(
        isEmail ? config.email_stagger_min_s : config.sms_stagger_min_s,
        isEmail ? config.email_stagger_max_s : config.sms_stagger_max_s
      );
    }
  }

  config.last_run = new Date().toISOString();
  saveConfig(config);

  if (!isDryRun) {
    writeLog('pitcher', [
      `sent: ${sent}  manual_drafts: ${manual}  errors: ${errors}`,
      `sent_today: ${config.sent_today} / ${config.daily_limit}  total_month: ${config.sent_this_month}`
    ]);
  }

  console.log('\n' + '─'.repeat(50));
  if (isDryRun) {
    console.log(`Dry run complete — ${toSend.length} messages previewed, nothing sent.`);
  } else {
    console.log('Done.');
    console.log(`  Sent (email/SMS): ${sent}`);
    console.log(`  Manual drafts:    ${manual} (check messages/*-draft.txt)`);
    console.log(`  Errors:           ${errors}`);
    console.log(`  Sent today:       ${config.sent_today} / ${config.daily_limit}`);
    console.log(`  Sent this month:  ${config.sent_this_month}`);
  }
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
