#!/usr/bin/env node
'use strict';

// strategist.js — business intelligence and pricing monitor
//
// Zero API cost. Reads pipeline data, computes metrics, flags alerts.
//
// Usage:
//   node strategy/agents/strategist.js --monitor     (weekly health check)
//   node strategy/agents/strategist.js --pricing     (pricing model analysis)
//   node strategy/agents/strategist.js --dashboard   (terminal dashboard, human-readable)
//   node strategy/agents/strategist.js --alerts      (print active alerts only)

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..', '..');
const REEVE_DIR    = path.join(ROOT, 'reeve');
const REPORTS_DIR  = path.join(__dirname, '..', 'reports');

const args        = process.argv.slice(2);
const isMonitor   = args.includes('--monitor');
const isPricing   = args.includes('--pricing');
const isDashboard = args.includes('--dashboard') || args.length === 0;
const isAlerts    = args.includes('--alerts');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// ── Data loaders ──────────────────────────────────────────────────────────────

function loadDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dirPath, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function loadClients() {
  return loadDir(path.join(REEVE_DIR, 'output', 'clients'));
}

function loadOpportunities() {
  return loadDir(path.join(REEVE_DIR, 'output', 'opportunities'));
}

function loadConversations() {
  return loadDir(path.join(REEVE_DIR, 'output', 'conversations'));
}

function loadDrafts() {
  return loadDir(path.join(REEVE_DIR, 'output', 'pitches'));
}

// ── Metric calculations ───────────────────────────────────────────────────────

const TIER_PRICE = { scout: 97, pitch: 297, full: 597, starter: 597 };

function calcMRR(clients) {
  const active = clients.filter(c => c.status === 'active');
  return active.reduce((sum, c) => {
    const price = TIER_PRICE[c.retainerTier] || 0;
    return sum + price;
  }, 0);
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

function calcConversionRate(conversations, clients) {
  const routed  = conversations.filter(c => c.routed).length;
  const converted = clients.length;
  if (!routed) return null;
  return Math.round((converted / routed) * 100);
}

function calcPitchAcceptanceRate(drafts) {
  const sent     = drafts.filter(d => d.type === 'pitch' && d.status === 'sent');
  const accepted = sent.filter(d => d.response === 'accepted');
  if (!sent.length) return null;
  return Math.round((accepted.length / sent.length) * 100);
}

function calcAvgBookingsPerClient(clients) {
  const active = clients.filter(c => c.status === 'active' && c.bookings_confirmed > 0);
  if (!active.length) return 0;
  const total = active.reduce((s, c) => s + (c.bookings_confirmed || 0), 0);
  return (total / clients.filter(c => c.status === 'active').length).toFixed(2);
}

function calcChurnRisk(clients) {
  const active = clients.filter(c => c.status === 'active');
  const noActivity = active.filter(c => {
    const age = daysSince(c.createdAt);
    return age > 60 && !(c.bookings_confirmed > 0);
  });
  return noActivity.map(c => ({ id: c.id, name: c.name, days: daysSince(c.createdAt) }));
}

function calcPipelineHealth(opps, drafts) {
  const today      = new Date().toISOString().split('T')[0];
  const open       = opps.filter(o => o.status === 'open');
  const urgent     = open.filter(o => o.cfpDeadline && o.cfpDeadline <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
  const pitchesSent = drafts.filter(d => d.type === 'pitch' && d.status === 'sent');
  const pendingReview = drafts.filter(d => d.status === 'draft');
  return { open: open.length, urgent: urgent.length, pitchesSent: pitchesSent.length, pendingReview: pendingReview.length };
}

// ── Alert engine ──────────────────────────────────────────────────────────────

const THRESHOLDS = {
  conversion_rate_min:         10,  // % leads that become clients
  pitch_acceptance_min:        10,  // % pitches accepted
  churn_risk_days:             60,  // days active with no booking = churn risk
  max_clients_no_booking_pct:  40,  // % of active clients with no booking = pricing mismatch signal
  mrr_target_6mo:           5000,  // $5k MRR target for 6-month mark
};

function generateAlerts(metrics) {
  const alerts = [];

  if (metrics.conversion_rate !== null && metrics.conversion_rate < THRESHOLDS.conversion_rate_min) {
    alerts.push({
      severity: 'HIGH',
      metric:   'conversion_rate',
      value:    `${metrics.conversion_rate}%`,
      threshold: `${THRESHOLDS.conversion_rate_min}%`,
      action:   'Qualifier is too aggressive. Review DM routing — consider adding Scout tier ($97/mo) for low-fit leads instead of declining.',
    });
  }

  if (metrics.pitch_acceptance_rate !== null && metrics.pitch_acceptance_rate < THRESHOLDS.pitch_acceptance_min) {
    alerts.push({
      severity: 'HIGH',
      metric:   'pitch_acceptance_rate',
      value:    `${metrics.pitch_acceptance_rate}%`,
      threshold: `${THRESHOLDS.pitch_acceptance_min}%`,
      action:   'Pitches are not landing. Audit pitch email quality — check subject lines, hook sentences, and client-conference topic match scores.',
    });
  }

  if (metrics.churn_risk_clients.length > 0) {
    alerts.push({
      severity: 'MEDIUM',
      metric:   'churn_risk',
      value:    `${metrics.churn_risk_clients.length} client(s) at risk`,
      threshold: `0 days >60 without a booking`,
      action:   `Run closer.js and pitcher.js for: ${metrics.churn_risk_clients.map(c => c.name).join(', ')}. Then check pipeline quality.`,
    });
  }

  if (metrics.mrr === 0 && metrics.total_clients === 0) {
    alerts.push({
      severity: 'INFO',
      metric:   'mrr',
      value:    '$0 MRR',
      threshold: 'any revenue',
      action:   'No paying clients yet. Run Phase 1: onboard 3 free/performance clients to validate booking success before charging retainers. See strategy/reports/pricing-analysis-2026-06-05.md',
    });
  }

  if (metrics.pipeline.pending_review > 5) {
    alerts.push({
      severity: 'MEDIUM',
      metric:   'pending_drafts',
      value:    `${metrics.pipeline.pending_review} drafts pending review`,
      threshold: '5',
      action:   'Run: node scripts/review-drafts.js to clear the queue. Drafts sitting >48h have stale context.',
    });
  }

  if (metrics.pipeline.urgent_cfps > 0) {
    alerts.push({
      severity: 'HIGH',
      metric:   'cfp_deadlines',
      value:    `${metrics.pipeline.urgent_cfps} CFP(s) expiring within 7 days`,
      threshold: '0',
      action:   'Run pitcher.js immediately. Missed deadlines are lost revenue.',
    });
  }

  return alerts;
}

// ── Pricing model assessment ───────────────────────────────────────────────────

function assessPricingModel(metrics) {
  const lines = [];

  lines.push('═══ PRICING MODEL ASSESSMENT ═══\n');
  lines.push(`Current MRR: $${metrics.mrr}`);
  lines.push(`Active clients: ${metrics.active_clients}`);
  lines.push(`Avg bookings/client: ${metrics.avg_bookings_per_client}`);
  lines.push('');

  if (metrics.active_clients === 0) {
    lines.push('STAGE: Pre-revenue. No pricing data available yet.');
    lines.push('');
    lines.push('RECOMMENDATION: Do not charge until first booking is confirmed.');
    lines.push('Run 3 clients on performance-only (15% per booking) to:');
    lines.push('  1. Prove you can get speakers booked');
    lines.push('  2. Collect testimonials');
    lines.push('  3. Establish actual pipeline metrics before setting retainer price');
    lines.push('');
    lines.push('Full pricing analysis: strategy/reports/pricing-analysis-2026-06-05.md');
    return lines.join('\n');
  }

  // Assess current tier distribution
  const tierCounts = { scout: 0, pitch: 0, full: 0, starter: 0 };
  // (would read from client data when clients exist)

  lines.push('RECOMMENDED TIERS (from pricing analysis):');
  lines.push('  Scout:  $97/mo  — opportunity digest, no pitching');
  lines.push('  Pitch:  $297/mo — full outbound pitching, 8 conferences/mo');
  lines.push('  Full:   $597/mo — pitch + one-sheet + negotiation + closer');
  lines.push('');
  lines.push('CURRENT RISK: $597/mo retainer with no proof of bookings = high churn in first 90 days.');
  lines.push('MITIGATION: Lower entry to $297/mo until 3+ booking success stories are documented.');

  return lines.join('\n');
}

// ── Week-over-week trend comparison ───────────────────────────────────────────

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

// ── Compute all metrics ───────────────────────────────────────────────────────

function computeMetrics() {
  const clients       = loadClients();
  const opps          = loadOpportunities();
  const conversations = loadConversations();
  const drafts        = loadDrafts();

  const active  = clients.filter(c => c.status === 'active');
  const mrr     = calcMRR(clients);
  const pipeline = calcPipelineHealth(opps, drafts);

  return {
    timestamp:              new Date().toISOString(),
    mrr,
    arr:                    mrr * 12,
    total_clients:          clients.length,
    active_clients:         active.length,
    conversion_rate:        calcConversionRate(conversations, clients),
    pitch_acceptance_rate:  calcPitchAcceptanceRate(drafts),
    avg_bookings_per_client: calcAvgBookingsPerClient(clients),
    churn_risk_clients:     calcChurnRisk(clients),
    total_conversations:    conversations.length,
    routed_conversations:   conversations.filter(c => c.routed).length,
    pipeline: {
      open_opps:       pipeline.open,
      urgent_cfps:     pipeline.urgent,
      pitches_sent:    pipeline.pitchesSent,
      pending_review:  pipeline.pendingReview,
    },
  };
}

// ── Output formatters ─────────────────────────────────────────────────────────

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

// ── Save report ───────────────────────────────────────────────────────────────

function saveMonitorReport(metrics, alerts) {
  const date = new Date().toISOString().split('T')[0];
  const reportPath = path.join(REPORTS_DIR, `monitor-${date}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ metrics, alerts }, null, 2), 'utf8');
  console.log(`Monitor report saved: strategy/reports/monitor-${date}.json`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
