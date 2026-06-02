#!/usr/bin/env node
/**
 * Reporter — sends a morning summary email covering costs, pipeline, and template stats
 *
 * Usage:
 *   node scripts/reporter.js              (print + email)
 *   node scripts/reporter.js --print      (print only, no email)
 *
 * Reads:  config/cost-log.json            (Anthropic / Twilio / Outscraper events)
 *         config/pitcher-config.json      (send counts)
 *         config/diagnoser-config.json    (Anthropic monthly cap)
 *         config/scout-config.json        (Outscraper monthly spend + cap)
 *         config/template-stats.json      (reply rates per template)
 *         config/drip-config.json         (drip send counts + daily limit)
 *         state.json                      (pipeline counts)
 *         messages/*-sent.json            (drip step tracking)
 *         .env.local                      (ZOHO_EMAIL, ZOHO_APP_PASSWORD, REPORT_TO_EMAIL)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const { getDailySummary, getMonthlySummary, TWILIO_PER_SMS_USD } = require('./cost-tracker');

const ROOT         = path.join(__dirname, '..');
const MESSAGES_DIR = path.join(ROOT, 'messages');

const args      = process.argv.slice(2);
const printOnly = args.includes('--print');

// ── HELPERS ───────────────────────────────────────────────────────────────────

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function fmt(n, decimals = 4) {
  return n.toFixed(decimals);
}

function pct(replies, sent) {
  if (!sent) return '—';
  return ((replies / sent) * 100).toFixed(0) + '%';
}

// ── BUILD REPORT ──────────────────────────────────────────────────────────────

function buildDripStats() {
  const dripCfg = readJson(path.join(ROOT, 'config', 'drip-config.json')) || {};
  const delays  = {
    d1: dripCfg.d1_delay_days || 4, d1b: dripCfg.d1b_delay_days || 8,
    d1c: dripCfg.d1c_delay_days || 12, d2: dripCfg.d2_delay_days || 19
  };
  const steps = ['d1', 'd1b', 'd1c', 'd2'];
  const stats = {};
  for (const s of steps) stats[s] = { email_sent: 0, sms_sent: 0, email_due: 0, sms_due: 0 };
  let unresponsive = 0;

  if (!fs.existsSync(MESSAGES_DIR)) return { stats, unresponsive, dripCfg };

  const files = fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json'));
  for (const file of files) {
    try {
      const sent = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, file), 'utf8'));
      if (sent.status === 'unresponsive') { unresponsive++; continue; }
      if (sent.status === 'positive') continue;
      const drip = sent.drip || {};
      for (const ch of ['email', 'sms']) {
        const initAt = ch === 'email' ? sent.email_sent_at : sent.sms_sent_at;
        if (!initAt) continue;
        const days = (Date.now() - new Date(initAt).getTime()) / 86400000;
        for (const step of steps) {
          if (drip[step]?.[`${ch}_sent_at`]) { stats[step][`${ch}_sent`]++; break; }
          if (days >= delays[step]) { stats[step][`${ch}_due`]++; break; }
          break;
        }
      }
    } catch { /* ignore */ }
  }
  return { stats, unresponsive, dripCfg };
}

function buildReport() {
  const pitcherCfg = readJson(path.join(ROOT, 'config', 'pitcher-config.json')) || {};
  const diagCfg    = readJson(path.join(ROOT, 'config', 'diagnoser-config.json')) || {};
  const scoutCfg   = readJson(path.join(ROOT, 'config', 'scout-config.json')) || {};
  const tmplStats  = readJson(path.join(ROOT, 'config', 'template-stats.json')) || {};
  const state      = readJson(path.join(ROOT, 'state.json')) || {};

  const yday  = yesterday();
  const month = currentMonth();

  const dayCosts = getDailySummary(yday);
  const monCosts = getMonthlySummary(month);

  // Pipeline status counts
  const queue    = state.queue || [];
  const byStatus = {};
  for (const e of queue) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }

  // Monthly send counts — per channel
  const smsSentMonth    = pitcherCfg.sms_sent_this_month   || pitcherCfg.sent_this_month || 0;
  const emailSentMonth  = pitcherCfg.email_sent_this_month || 0;
  const totalSentMonth  = pitcherCfg.sent_this_month       || 0;
  const smsCostMonth    = smsSentMonth * TWILIO_PER_SMS_USD;

  // Outscraper monthly spend (from scout config)
  const outscraperMonthCost = scoutCfg.spent_this_month || 0;
  const outscraperCap       = scoutCfg.monthly_cap || 10;

  // Anthropic monthly spend (from cost-log events)
  const anthropicMonthCost  = monCosts.anthropic?.cost_usd || 0;
  const anthropicCap        = diagCfg.monthly_cap || 5;

  // Total monthly
  const totalMonthCost = anthropicMonthCost + smsCostMonth + outscraperMonthCost;

  // Yesterday anthropic cost (from cost-log)
  const anthropicYdayCost = dayCosts.anthropic?.cost_usd || 0;
  const twilioYdayCost    = dayCosts.twilio?.cost_usd    || 0;
  const outscraperYdayCost = dayCosts.outscraper?.cost_usd || 0;
  const totalYdayCost = anthropicYdayCost + twilioYdayCost + outscraperYdayCost;

  const { stats: dripStats, unresponsive: dripUnresponsive, dripCfg } = buildDripStats();

  // Template performance
  const templates = [];
  for (const [id, s] of Object.entries(tmplStats.sms   || {})) {
    if (s.sent > 0) templates.push({ ch: 'sms',   id, ...s });
  }
  for (const [id, s] of Object.entries(tmplStats.email || {})) {
    if (s.sent > 0) templates.push({ ch: 'email', id, ...s });
  }

  // Format date header
  const dateHeader = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const sep  = '─'.repeat(44);
  const sep2 = '━'.repeat(44);
  const L    = [];

  L.push(sep2);
  L.push('  TREVO ADVISORS — MORNING REPORT');
  L.push(`  ${dateHeader}`);
  L.push(sep2);
  L.push('');

  // Pipeline
  L.push('PIPELINE STATUS');
  L.push(sep);
  const statusOrder = [
    ['scouted',          'Scouted (not yet diagnosed)'],
    ['diagnosed',        'Diagnosed (not yet checked)'],
    ['checked',          'Approved (not yet sent)'],
    ['sent',             'Sent — awaiting reply'],
    ['replied',          'Replied'],
    ['meeting_booked',   'Meeting booked'],
    ['deal_closed',      'Deal closed'],
    ['manual_pending',   'Manual send pending'],
    ['mockup_pending',   'Mockup pending'],
  ];
  let anyPipeline = false;
  for (const [status, label] of statusOrder) {
    const n = byStatus[status];
    if (n) { L.push(`  ${label.padEnd(30)} ${n}`); anyPipeline = true; }
  }
  if (!anyPipeline) L.push('  No leads in pipeline.');
  L.push('');

  // Send totals
  L.push('OUTREACH — MONTH TO DATE');
  L.push(sep);
  L.push(`  Email sent:      ${emailSentMonth}  (via Zoho SMTP)`);
  L.push(`  SMS sent:        ${smsSentMonth}  (via Twilio)`);
  L.push(`  Total:           ${totalSentMonth}`);
  L.push(`  Daily limit:     ${pitcherCfg.daily_limit || 30}`);
  L.push(`  All-time total:  ${pitcherCfg.total_sent || 0}`);
  L.push('');

  // Template performance
  if (templates.length > 0) {
    L.push('TEMPLATE PERFORMANCE');
    L.push(sep);
    L.push(`  ${'ID'.padEnd(6)} ${'Channel'.padEnd(7)} ${'Sent'.padStart(5)}  ${'Replies'.padStart(7)}  ${'Rate'.padStart(5)}`);
    L.push(`  ${'-'.repeat(38)}`);
    for (const t of templates) {
      L.push(`  ${t.id.padEnd(6)} ${t.ch.padEnd(7)} ${String(t.sent).padStart(5)}  ${String(t.replies).padStart(7)}  ${pct(t.replies, t.sent).padStart(5)}`);
    }
    L.push('');
  }

  // Drip campaign status
  const dripSteps = ['d1', 'd1b', 'd1c', 'd2'];
  const dripLabels = { d1: 'Day 4  (soft check-in)', d1b: 'Day 8  (missed call)', d1c: 'Day 12 (competitor)', d2: 'Day 19 (breakup)' };
  const anyDrip = dripSteps.some(s => Object.values(dripStats[s]).some(v => v > 0)) || dripUnresponsive > 0;
  if (anyDrip) {
    L.push('DRIP CAMPAIGN STATUS');
    L.push(sep);
    L.push(`  ${'Step'.padEnd(24)} ${'Email'.padStart(14)}  ${'SMS'.padStart(14)}`);
    L.push(`  ${''.padEnd(24)} ${'due / sent'.padStart(14)}  ${'due / sent'.padStart(14)}`);
    L.push(`  ${'-'.repeat(54)}`);
    for (const step of dripSteps) {
      const s = dripStats[step];
      const emailCol = `${s.email_due} / ${s.email_sent}`;
      const smsCol   = `${s.sms_due} / ${s.sms_sent}`;
      L.push(`  ${dripLabels[step].padEnd(24)} ${emailCol.padStart(14)}  ${smsCol.padStart(14)}`);
    }
    L.push(`  ${'Unresponsive'.padEnd(24)} ${String(dripUnresponsive).padStart(14)}`);
    L.push(`  Drip daily limit: ${dripCfg.daily_limit || 20}  |  Sent today: ${dripCfg.sent_today || 0}`);
    L.push('');
  }

  // Yesterday costs
  if (totalYdayCost > 0) {
    L.push(`COSTS — YESTERDAY (${yday})`);
    L.push(sep);
    if (anthropicYdayCost > 0) L.push(`  Anthropic API:   $${fmt(anthropicYdayCost)}  (${dayCosts.anthropic?.input_tokens || 0} in / ${dayCosts.anthropic?.output_tokens || 0} out tokens)`);
    if (twilioYdayCost    > 0) L.push(`  Twilio SMS:      $${fmt(twilioYdayCost)}  (${dayCosts.twilio?.messages || 0} msgs × $${TWILIO_PER_SMS_USD})`);
    if (outscraperYdayCost> 0) L.push(`  Outscraper:      $${fmt(outscraperYdayCost)}  (${dayCosts.outscraper?.leads || 0} leads)`);
    L.push(`  ${'─'.repeat(28)}`);
    L.push(`  Total yesterday: $${fmt(totalYdayCost)}`);
    L.push('');
  }

  // Month-to-date costs
  L.push(`COSTS — ${month} (MONTH TO DATE)`);
  L.push(sep);
  L.push(`  Anthropic API:   $${fmt(anthropicMonthCost)}  / $${anthropicCap.toFixed(2)} cap`);
  if (emailSentMonth > 0)
    L.push(`  Zoho Email:      $0.0000  (${emailSentMonth} msgs — flat subscription)`);
  L.push(`  Twilio SMS:      $${fmt(smsCostMonth)}  (${smsSentMonth} msgs × $${TWILIO_PER_SMS_USD})`);
  L.push(`  Outscraper:      $${fmt(outscraperMonthCost)}  / $${outscraperCap.toFixed(2)} cap`);
  L.push(`  ${'─'.repeat(28)}`);
  L.push(`  Total MTD:       $${fmt(totalMonthCost)}`);
  L.push('');

  L.push(sep);
  L.push('  Trevo Advisors AI Pipeline — dave@trevoadvisors.com');
  L.push('  Run: node scripts/reporter.js --print  to preview');
  L.push(sep);

  return L.join('\n');
}

// ── SEND EMAIL ────────────────────────────────────────────────────────────────

async function sendReport(body) {
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  const to   = process.env.REPORT_TO_EMAIL || process.env.ZOHO_EMAIL;

  if (!user || !pass) throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local');
  if (!to)            throw new Error('REPORT_TO_EMAIL (or ZOHO_EMAIL) must be set in .env.local');

  const transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user, pass }
  });

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject   = `Trevo Advisors Report — ${dateLabel}`;

  await transport.sendMail({
    from:    `Trevo Advisors <${user}>`,
    to,
    subject,
    text:    body
  });

  return { subject, to };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const body = buildReport();
  console.log(body);

  if (printOnly) {
    console.log('\n[--print mode: email not sent]');
    return;
  }

  try {
    const { subject, to } = await sendReport(body);
    console.log(`\n✓ Report sent to ${to}`);
    console.log(`  Subject: "${subject}"`);
  } catch (err) {
    console.error(`\n✗ Email failed: ${err.message}`);
    console.error('  Run with --print to view report without emailing.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
