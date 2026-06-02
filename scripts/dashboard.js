#!/usr/bin/env node
/**
 * Dashboard — live pipeline status view for the terminal
 *
 * Usage:
 *   node scripts/dashboard.js           (full view)
 *   node scripts/dashboard.js --leads   (active leads detail)
 *   node scripts/dashboard.js --drip    (drip queue only)
 *
 * Reads:  state.json  messages/*-sent.json  queue/*-brief.json
 *         config/pitcher-config.json  config/drip-config.json  config/cost-log.json
 */

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');
const STATE_PATH   = path.join(ROOT, 'state.json');

const args       = process.argv.slice(2);
const showLeads  = args.includes('--leads');
const showDrip   = args.includes('--drip');
const showAll    = !showLeads && !showDrip;

// ── HELPERS ───────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function addDays(iso, n) {
  if (!iso) return '—';
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pad(str, len, right = false) {
  const s = String(str ?? '');
  return right ? s.padStart(len) : s.padEnd(len);
}

const sep  = '─'.repeat(60);
const sep2 = '━'.repeat(60);

// ── DATA LOADER ───────────────────────────────────────────────────────────────

function loadData() {
  const state      = readJson(STATE_PATH)                                              || { queue: [] };
  const pitcherCfg = readJson(path.join(ROOT, 'config', 'pitcher-config.json'))       || {};
  const dripCfg    = readJson(path.join(ROOT, 'config', 'drip-config.json'))          || {};

  // Load all sent records
  const sentMap = new Map(); // leadId → sentRecord
  if (fs.existsSync(MESSAGES_DIR)) {
    for (const f of fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json'))) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, f), 'utf8'));
        sentMap.set(f.replace('-sent.json', ''), rec);
      } catch { /* skip */ }
    }
  }

  // Load all briefs
  const briefMap = new Map(); // leadId → brief
  if (fs.existsSync(QUEUE_DIR)) {
    for (const f of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
      try {
        const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8'));
        briefMap.set(f.replace('-brief.json', ''), brief);
      } catch { /* skip */ }
    }
  }

  return { state, pitcherCfg, dripCfg, sentMap, briefMap };
}

// ── SECTIONS ──────────────────────────────────────────────────────────────────

function printSummary(state, pitcherCfg, dripCfg, sentMap) {
  const queue    = state.queue || [];
  const byStatus = {};
  for (const e of queue) byStatus[e.status] = (byStatus[e.status] || 0) + 1;

  let dripActive = 0, dripDone = 0;
  const delays   = {
    d1: dripCfg.d1_delay_days || 4,
    d1b: dripCfg.d1b_delay_days || 8,
    d1c: dripCfg.d1c_delay_days || 12,
    d2: dripCfg.d2_delay_days || 19
  };
  const steps = ['d1', 'd1b', 'd1c', 'd2'];

  for (const [, sent] of sentMap) {
    if (sent.status === 'positive' || sent.status === 'unsubscribed' || sent.status === 'unresponsive') continue;
    const drip = sent.drip || {};
    const allDone = steps.every(s => ['email', 'sms'].every(ch => !sent[`${ch}_sent_at`] || drip[s]?.[`${ch}_sent_at`]));
    allDone ? dripDone++ : dripActive++;
  }

  console.log(sep2);
  console.log('  TREVO ADVISORS — PIPELINE DASHBOARD');
  console.log(`  ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  console.log(sep2);
  console.log('');
  console.log('PIPELINE SUMMARY');
  console.log(sep);

  const rows = [
    ['Scouted (not yet diagnosed)',    byStatus['scouted']         || 0],
    ['Diagnosed (not yet checked)',    byStatus['diagnosed']       || 0],
    ['Approved (not yet sent)',        byStatus['checked']         || 0],
    ['Sent — awaiting reply',          byStatus['sent']            || 0],
    ['Drip active',                    dripActive],
    ['Positive replies',               byStatus['replied']         || 0],
    ['Meeting booked',                 byStatus['meeting_booked']  || 0],
    ['Deals closed',                   byStatus['deal_closed']     || 0],
    ['Unsubscribed',                   byStatus['unsubscribed']    || 0],
    ['Unresponsive',                   byStatus['unresponsive']    || 0],
  ];

  for (const [label, count] of rows) {
    if (count > 0) console.log(`  ${pad(label, 34)} ${pad(count, 4, true)}`);
  }

  console.log('');
  console.log('OUTREACH TOTALS');
  console.log(sep);
  console.log(`  Email sent (MTD):    ${pitcherCfg.email_sent_this_month || 0}`);
  console.log(`  SMS sent (MTD):      ${pitcherCfg.sms_sent_this_month   || pitcherCfg.sent_this_month || 0}`);
  console.log(`  Drip sent today:     ${dripCfg.sent_today || 0} / ${dripCfg.daily_limit || 20}`);
  console.log(`  All-time total:      ${pitcherCfg.total_sent || 0}`);
  console.log('');
}

function printLeads(sentMap, briefMap, dripCfg) {
  const delays = {
    d1: dripCfg.d1_delay_days || 4,
    d1b: dripCfg.d1b_delay_days || 8,
    d1c: dripCfg.d1c_delay_days || 12,
    d2: dripCfg.d2_delay_days || 19
  };
  const steps = ['d1', 'd1b', 'd1c', 'd2'];

  // Group leads by status bucket
  const active    = [];
  const replied   = [];
  const inactive  = [];

  for (const [leadId, sent] of sentMap) {
    const brief   = briefMap.get(leadId) || {};
    const name    = brief.business_name || leadId;
    const initAt  = sent.email_sent_at || sent.sms_sent_at;
    const days    = daysSince(initAt);
    const drip    = sent.drip || {};
    const status  = sent.status || '—';
    const channel = sent.email_sent_at ? (sent.sms_sent_at ? 'email+sms' : 'email') : 'sms';

    // Find next due drip step
    let nextStep = null, nextDue = null;
    for (const step of steps) {
      const delay       = delays[step];
      const emailNeeded = !!sent.email_sent_at && !drip[step]?.email_sent_at;
      const smsNeeded   = !!sent.sms_sent_at   && !drip[step]?.sms_sent_at;
      if (!emailNeeded && !smsNeeded) continue;
      nextStep = step;
      nextDue  = addDays(initAt, delay);
      break;
    }

    const row = { leadId, name, status, channel, days, initAt, nextStep, nextDue, drip };

    if (status === 'positive' || status === 'replied' || status === 'meeting_booked' || status === 'deal_closed') {
      replied.push(row);
    } else if (status === 'unresponsive' || status === 'unsubscribed') {
      inactive.push(row);
    } else {
      active.push(row);
    }
  }

  // Sort active by days sent (oldest first — most overdue)
  active.sort((a, b) => (b.days || 0) - (a.days || 0));

  if (active.length > 0) {
    console.log('ACTIVE LEADS');
    console.log(sep);
    console.log(`  ${pad('Business', 28)} ${pad('Ch', 9)} ${pad('Sent', 5)} ${pad('Next step', 8)} ${pad('Due', 8)}`);
    console.log(`  ${'─'.repeat(58)}`);
    for (const r of active) {
      const nameShort = r.name.length > 27 ? r.name.slice(0, 24) + '...' : r.name;
      const daysStr   = r.days !== null ? `${r.days}d ago` : '—';
      const stepStr   = r.nextStep || 'done';
      const dueStr    = r.nextDue  || '—';
      console.log(`  ${pad(nameShort, 28)} ${pad(r.channel, 9)} ${pad(daysStr, 7)} ${pad(stepStr, 9)} ${dueStr}`);
    }
    console.log('');
  }

  if (replied.length > 0) {
    console.log('POSITIVE REPLIES');
    console.log(sep);
    for (const r of replied) {
      console.log(`  ${r.name.padEnd(30)} ${r.status.toUpperCase()}`);
    }
    console.log('');
  }

  if (inactive.length > 0) {
    console.log(`CLOSED OUT (${inactive.length})`);
    console.log(sep);
    for (const r of inactive) {
      console.log(`  ${r.name.padEnd(30)} ${r.status.toUpperCase()}`);
    }
    console.log('');
  }
}

function printDripQueue(sentMap, briefMap, dripCfg) {
  const delays = {
    d1: dripCfg.d1_delay_days || 4,
    d1b: dripCfg.d1b_delay_days || 8,
    d1c: dripCfg.d1c_delay_days || 12,
    d2: dripCfg.d2_delay_days || 19
  };
  const steps = ['d1', 'd1b', 'd1c', 'd2'];

  const due     = [];
  const pending = [];

  for (const [leadId, sent] of sentMap) {
    if (sent.status === 'positive' || sent.status === 'unsubscribed' || sent.status === 'unresponsive') continue;
    const brief  = briefMap.get(leadId) || {};
    const name   = brief.business_name || leadId;
    const drip   = sent.drip || {};

    for (const ch of ['email', 'sms']) {
      const initAt = ch === 'email' ? sent.email_sent_at : sent.sms_sent_at;
      if (!initAt) continue;
      const days = (Date.now() - new Date(initAt).getTime()) / 86400000;

      for (const step of steps) {
        if (drip[step]?.[`${ch}_sent_at`]) continue;
        const delay = delays[step];
        const dueOn = addDays(initAt, delay);
        if (days >= delay) {
          due.push({ name, step, ch, dueOn, daysOverdue: Math.floor(days - delay) });
        } else {
          pending.push({ name, step, ch, dueOn, daysUntil: Math.ceil(delay - days) });
        }
        break;
      }
    }
  }

  due.sort((a, b) => b.daysOverdue - a.daysOverdue);
  pending.sort((a, b) => a.daysUntil - b.daysUntil);

  console.log('DRIP QUEUE');
  console.log(sep);

  if (due.length === 0 && pending.length === 0) {
    console.log('  No leads in drip queue.');
  }

  if (due.length > 0) {
    console.log(`  ► DUE NOW (${due.length}) — run: node scripts/drip.js --force`);
    console.log(`  ${pad('Business', 28)} ${pad('Step', 5)} ${pad('Ch', 6)} ${pad('Was due', 8)}`);
    console.log(`  ${'─'.repeat(52)}`);
    for (const r of due) {
      const name = r.name.length > 27 ? r.name.slice(0, 24) + '...' : r.name;
      const overdue = r.daysOverdue > 0 ? `${r.daysOverdue}d ago` : 'today';
      console.log(`  ${pad(name, 28)} ${pad(r.step, 5)} ${pad(r.ch, 6)} ${overdue}`);
    }
    console.log('');
  }

  if (pending.length > 0) {
    const showing = pending.slice(0, 10);
    console.log(`  ○ UPCOMING (${pending.length})`);
    console.log(`  ${pad('Business', 28)} ${pad('Step', 5)} ${pad('Ch', 6)} ${pad('Due on', 8)}`);
    console.log(`  ${'─'.repeat(52)}`);
    for (const r of showing) {
      const name = r.name.length > 27 ? r.name.slice(0, 24) + '...' : r.name;
      console.log(`  ${pad(name, 28)} ${pad(r.step, 5)} ${pad(r.ch, 6)} ${r.dueOn} (in ${r.daysUntil}d)`);
    }
    if (pending.length > 10) console.log(`  ... and ${pending.length - 10} more`);
    console.log('');
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const { state, pitcherCfg, dripCfg, sentMap, briefMap } = loadData();

  if (showAll || (!showLeads && !showDrip)) {
    printSummary(state, pitcherCfg, dripCfg, sentMap);
  }

  if (showAll || showLeads) {
    printLeads(sentMap, briefMap, dripCfg);
  }

  if (showAll || showDrip) {
    printDripQueue(sentMap, briefMap, dripCfg);
  }

  console.log(sep);
  console.log('  node scripts/dashboard.js --leads   (lead detail)');
  console.log('  node scripts/dashboard.js --drip    (drip queue only)');
  console.log(sep);
}

main();
