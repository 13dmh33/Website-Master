#!/usr/bin/env node
'use strict';

// strategist.js — business intelligence and pricing monitor CLI
//
// Zero API cost. Reads pipeline data, computes metrics, flags alerts.
// Thin CLI wrapper — all data-loading/metric/alert logic now lives in
// ../lib/reeve-metrics.js (extracted 2026-07-29 so merlin/lib/reeve-snapshot.js
// can reuse it directly instead of re-implementing it a second time). This
// file's own behavior is unchanged: same flags, same output.
//
// Usage:
//   node strategy/agents/strategist.js --monitor     (weekly health check)
//   node strategy/agents/strategist.js --pricing     (pricing model analysis)
//   node strategy/agents/strategist.js --dashboard   (terminal dashboard, human-readable)
//   node strategy/agents/strategist.js --alerts      (print active alerts only)

const fs   = require('fs');
const path = require('path');

const {
  computeMetrics, generateAlerts, assessPricingModel,
} = require('../lib/reeve-metrics');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');

const args        = process.argv.slice(2);
const isMonitor   = args.includes('--monitor');
const isPricing   = args.includes('--pricing');
const isDashboard = args.includes('--dashboard') || args.length === 0;
const isAlerts    = args.includes('--alerts');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── Week-over-week trend comparison ─────────────────────────────────────────

function loadLastWeekMetrics() {
  if (!fs.existsSync(REPORTS_DIR)) return null;
  const reports = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.startsWith('monitor-') && f.endsWith('.json'))
    .sort()
    .reverse();
  // skip index 0 (today's if already saved) and take the next most recent
  for (const file of reports.slice(0, 5)) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
      if (data.metrics) return data.metrics;
    } catch { /* skip */ }
  }
  return null;
}

function calcTrend(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current > 0 ? '+∞' : '—';
  const delta = current - previous;
  const pct   = Math.round((delta / Math.abs(previous)) * 100);
  return `${delta >= 0 ? '+' : ''}${delta} (${pct >= 0 ? '+' : ''}${pct}%)`;
}

// ── Output formatters ────────────────────────────────────────────────────────

function printDashboard(metrics, alerts) {
  const SEV_COLOR = { HIGH: '🔴', MEDIUM: '🟡', INFO: '🔵' };
  const prev = loadLastWeekMetrics();

  function trend(cur, prv) {
    const t = calcTrend(cur, prv);
    if (!t || t === '—') return '';
    const up = t.startsWith('+');
    return `  ${up ? '↑' : '↓'} ${t}`;
  }

  console.log('\n' + '═'.repeat(56));
  console.log('  REEVE STRATEGY DASHBOARD');
  console.log(`  ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
  if (prev) console.log('  (trends vs last saved snapshot)');
  console.log('═'.repeat(56));

  console.log('\n── REVENUE ──────────────────────────────────────────');
  console.log(`  MRR:             $${metrics.mrr.toLocaleString()}${trend(metrics.mrr, prev?.mrr)}`);
  console.log(`  ARR (projected): $${metrics.arr.toLocaleString()}`);
  console.log(`  Active clients:  ${metrics.active_clients}${trend(metrics.active_clients, prev?.active_clients)}`);

  console.log('\n── PIPELINE ─────────────────────────────────────────');
  console.log(`  Open CFPs:       ${metrics.pipeline.open_opps}${trend(metrics.pipeline.open_opps, prev?.pipeline?.open_opps)}`);
  console.log(`  Urgent (7d):     ${metrics.pipeline.urgent_cfps}`);
  console.log(`  Pitches sent:    ${metrics.pipeline.pitches_sent}${trend(metrics.pipeline.pitches_sent, prev?.pipeline?.pitches_sent)}`);
  console.log(`  Pending review:  ${metrics.pipeline.pending_review}`);

  console.log('\n── CONVERSION ───────────────────────────────────────');
  console.log(`  DM leads routed: ${metrics.routed_conversations}${trend(metrics.routed_conversations, prev?.routed_conversations)}`);
  console.log(`  → Clients:       ${metrics.active_clients} (${metrics.conversion_rate !== null ? metrics.conversion_rate + '%' : 'n/a'})`);
  console.log(`  Pitch acceptance: ${metrics.pitch_acceptance_rate !== null ? metrics.pitch_acceptance_rate + '%' : 'no data yet'}`);
  console.log(`  Avg bookings/client: ${metrics.avg_bookings_per_client}`);

  if (metrics.churn_risk_clients.length > 0) {
    console.log('\n── CHURN RISK ───────────────────────────────────────');
    for (const c of metrics.churn_risk_clients) {
      console.log(`  ${c.name} — ${c.days} days active, no bookings confirmed`);
    }
  }

  if (alerts.length > 0) {
    console.log('\n── ALERTS ───────────────────────────────────────────');
    for (const a of alerts) {
      console.log(`\n  ${SEV_COLOR[a.severity]} ${a.severity} — ${a.metric}`);
      console.log(`  Value: ${a.value} (threshold: ${a.threshold})`);
      console.log(`  → ${a.action}`);
    }
  } else {
    console.log('\n── ALERTS ───────────────────────────────────────────');
    console.log('  ✓ No alerts. All metrics within range.');
  }

  console.log('\n' + '═'.repeat(56));
  console.log('  Full pricing analysis: strategy/reports/pricing-analysis-2026-06-05.md');
  console.log('  Run --monitor to save a snapshot to strategy/reports/');
  console.log('═'.repeat(56) + '\n');
}

// ── Save report ──────────────────────────────────────────────────────────────

function saveMonitorReport(metrics, alerts) {
  const date = new Date().toISOString().split('T')[0];
  const reportPath = path.join(REPORTS_DIR, `monitor-${date}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ metrics, alerts }, null, 2), 'utf8');
  console.log(`Monitor report saved: strategy/reports/monitor-${date}.json`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const metrics = computeMetrics();
  const alerts  = generateAlerts(metrics);

  if (isDashboard || isMonitor) {
    printDashboard(metrics, alerts);
  }

  if (isMonitor) {
    saveMonitorReport(metrics, alerts);
  }

  if (isPricing) {
    console.log('\n' + assessPricingModel(metrics));
    console.log('\nFull pricing analysis: strategy/reports/pricing-analysis-2026-06-05.md\n');
  }

  if (isAlerts) {
    if (!alerts.length) {
      console.log('\n✓ No active alerts.\n');
    } else {
      console.log(`\n${alerts.length} active alert(s):\n`);
      for (const a of alerts) {
        console.log(`[${a.severity}] ${a.metric}: ${a.value}`);
        console.log(`  → ${a.action}\n`);
      }
    }
  }
}

main();
