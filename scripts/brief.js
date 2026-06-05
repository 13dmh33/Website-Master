#!/usr/bin/env node
/**
 * Brief — daily action briefing for Dave
 *
 * Reads pipeline state and outputs a prioritized to-do list
 * for the day. Run every morning.
 *
 * Usage:
 *   node scripts/brief.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'queue');
const LEADS_DIR = path.join(ROOT, 'leads');
const MSG_DIR   = path.join(ROOT, 'messages');
const CFG_DIR   = path.join(ROOT, 'config');

// ── HELPERS ───────────────────────────────────────────────────────────────────

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function daysSince(isoStr) {
  if (!isoStr) return null;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000);
}

// ── PIPELINE STATS ────────────────────────────────────────────────────────────

function getPipelineStats() {
  const files = fs.existsSync(QUEUE_DIR)
    ? fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))
    : [];

  let approved = 0, unapproved = 0, emailChannel = 0, smsChannel = 0;
  let withDemoUrl = 0, withEmail = 0;

  for (const f of files) {
    const b = loadJSON(path.join(QUEUE_DIR, f));
    if (!b) continue;
    if (b.checker_approved) {
      approved++;
      if (b.channel === 'email' || b.secondary_channel === 'email') emailChannel++;
      if (b.channel === 'sms')  smsChannel++;
      if (b.demo_url)   withDemoUrl++;
      if (b.email)      withEmail++;
    } else {
      unapproved++;
    }
  }

  return { approved, unapproved, emailChannel, smsChannel, withDemoUrl, withEmail };
}

function getLeadStats() {
  if (!fs.existsSync(LEADS_DIR)) return { total: 0, needsEmail: 0 };
  const files = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));
  let total = 0, needsEmail = 0;
  for (const f of files) {
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, f), 'utf8'));
      for (const lead of leads) {
        total++;
        if (!lead.email) needsEmail++;
      }
    } catch { /* skip */ }
  }
  return { total, needsEmail };
}

function getSentStats() {
  if (!fs.existsSync(MSG_DIR)) return { smsSent: 0, emailSent: 0 };
  const sentFile = path.join(MSG_DIR, '-sent.json');
  const sent = loadJSON(sentFile);
  if (!sent) return { smsSent: 0, emailSent: 0 };

  let smsSent = 0, emailSent = 0;
  for (const id of Object.keys(sent)) {
    if (sent[id].channel === 'sms') smsSent++;
    if (sent[id].channel === 'email') emailSent++;
  }
  return { smsSent, emailSent };
}

function getEnricherConfig() {
  const cfg = loadJSON(path.join(CFG_DIR, 'enricher-config.json'));
  if (!cfg) return null;
  return cfg;
}

function getDripConfig() {
  const cfg = loadJSON(path.join(CFG_DIR, 'drip-config.json'));
  if (!cfg) return null;
  return cfg;
}

function getCostSummary() {
  const log = loadJSON(path.join(CFG_DIR, 'cost-log.json'));
  if (!log?.events) return null;

  const thisMonth = new Date().toISOString().substring(0, 7);
  const events = log.events.filter(e => e.ts.startsWith(thisMonth));

  const totals = {};
  for (const e of events) {
    totals[e.service] = (totals[e.service] || 0) + e.cost_usd;
  }
  return totals;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const now  = new Date();
  const day  = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const pipeline = getPipelineStats();
  const leads    = getLeadStats();
  const sent     = getSentStats();
  const enCfg    = getEnricherConfig();
  const cost     = getCostSummary() || {};

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  ${greeting}, Dave. ${day}`);
  console.log('═'.repeat(62));

  // ── PIPELINE SUMMARY ────────────────────────────────────────────────────────

  console.log('\n📊 Pipeline');
  console.log(`  ${pipeline.approved} leads approved in queue (${pipeline.smsChannel} SMS · ${pipeline.emailChannel} email)`);
  console.log(`  ${pipeline.withDemoUrl} have personalized demo URLs`);
  console.log(`  ${pipeline.withEmail} have email addresses`);
  console.log(`  ${sent.smsSent} SMS sent · ${sent.emailSent} emails sent this run`);
  console.log(`  ${leads.total} total leads scraped (${leads.needsEmail} without email)`);

  if (enCfg) {
    const month = now.toISOString().substring(0, 7);
    const creditsLeft = enCfg.monthly_cap_credits - (enCfg.current_month === month ? enCfg.credits_used : 0);
    console.log(`  Apollo enricher: ${enCfg.credits_used || 0} / ${enCfg.monthly_cap_credits} credits used · ${creditsLeft} remaining`);
  }

  // ── COSTS ────────────────────────────────────────────────────────────────────

  const totalCost = Object.values(cost).reduce((a, b) => a + b, 0);
  if (totalCost > 0) {
    console.log(`\n💰 Costs this month: $${totalCost.toFixed(2)}`);
    for (const [svc, amt] of Object.entries(cost)) {
      if (amt > 0) console.log(`  ${svc}: $${amt.toFixed(2)}`);
    }
  } else {
    console.log('\n💰 No costs logged this month yet.');
  }

  // ── TODAY'S ACTIONS ──────────────────────────────────────────────────────────

  console.log('\n🎯 Today\'s actions (priority order):');
  const actions = [];

  if (pipeline.approved > 0) {
    actions.push({
      priority: 1,
      label:   `Send ${Math.min(15, pipeline.approved)} personal SMS texts from iPhone`,
      cmd:     `node scripts/caller.js --sms --limit 15`,
      why:     'Zero cost, bypasses A2P block, fastest path to revenue today',
    });

    actions.push({
      priority: 2,
      label:   `Make ${Math.min(10, pipeline.approved)} cold calls`,
      cmd:     `node scripts/caller.js --limit 10`,
      why:     '2-5% close rate on first call; best ROI per hour',
    });
  }

  actions.push({
    priority: 3,
    label:   'Send 15 LinkedIn connection requests',
    cmd:     'node scripts/linkedin.js --limit 15',
    why:     '20-30% acceptance rate; warm channel for demos',
  });

  actions.push({
    priority: 4,
    label:   'Send 5 emails to referral partners (realtors / inspectors)',
    cmd:     'node scripts/referral.js --city "Denver, CO"',
    why:     '1 referral partner = 2-4 clients/month passively',
  });

  if (leads.needsEmail > 0) {
    actions.push({
      priority: 5,
      label:   `Run Apollo enricher (${leads.needsEmail} leads missing email)`,
      cmd:     'node scripts/enricher.js --force',
      why:     'Unlocks email channel; needs APOLLO_API_KEY in .env.local',
    });
  }

  for (const a of actions.sort((x, y) => x.priority - y.priority)) {
    console.log(`\n  ${a.priority}. ${a.label}`);
    console.log(`     $ ${a.cmd}`);
    console.log(`     → ${a.why}`);
  }

  // ── BLOCKERS ─────────────────────────────────────────────────────────────────

  console.log('\n⚠️  Current blockers:');
  const blockers = [];

  if (sent.smsSent === 0 && pipeline.smsChannel > 0) {
    blockers.push('Twilio A2P 10DLC pending — check Bundle SID BUb725ec9662f0dc3da58ed24117df8684');
  }
  if (!process.env.APOLLO_API_KEY && leads.needsEmail > 0) {
    blockers.push(`APOLLO_API_KEY not set — ${leads.needsEmail} leads need email enrichment`);
  }

  const checkoutHtml = fs.existsSync(path.join(ROOT, 'website/checkout/index.html'))
    ? fs.readFileSync(path.join(ROOT, 'website/checkout/index.html'), 'utf8')
    : '';
  if (checkoutHtml.includes('YOUR_WEBSITE_LINK_ID')) {
    blockers.push('Stripe Payment Links not configured — checkout takes no payments yet');
  }

  if (blockers.length === 0) {
    console.log('  None! Everything is operational.');
  } else {
    for (const b of blockers) {
      console.log(`  • ${b}`);
    }
  }

  // ── QUICK LINKS ──────────────────────────────────────────────────────────────

  console.log('\n🔗 Quick links:');
  console.log('  Site preview:     https://trevoadvisors.com/start/');
  console.log('  Atlas product:    https://trevoadvisors.com/atlas/');
  console.log('  Argus product:    https://trevoadvisors.com/argus/');
  console.log('  Demo sites:       https://trevoadvisors.com/demos/');
  console.log('  Twilio console:   https://console.twilio.com');
  console.log('  Apollo:           https://app.apollo.io/#/settings/integrations/api');

  console.log('\n' + '═'.repeat(62) + '\n');
}

main();
