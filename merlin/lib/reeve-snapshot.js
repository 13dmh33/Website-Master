'use strict';
/**
 * Reeve snapshot — Merlin's --reeve flag pulls Reeve's real business metrics
 * into the same nightly run as Trevo's, via strategy/lib/reeve-metrics.js
 * (extracted 2026-07-29 from strategy/agents/strategist.js, which now imports
 * the same functions rather than owning a separate copy). This is the fix for
 * "no single agent can say whether the next hour should go to Trevo or Reeve" —
 * Reeve's alerts/metrics feed the same ranked candidate pool Trevo's do, via
 * merlin/lib/ranking.js's reeveDynamicCandidates().
 *
 * Read-only, same as every other Merlin data source — never writes to Reeve's
 * own output/ directories.
 */

const { computeMetrics, generateAlerts } = require('../../strategy/lib/reeve-metrics');

function collectReeveSnapshot() {
  const metrics = computeMetrics();
  const alerts = generateAlerts(metrics);
  return { metrics, alerts };
}

module.exports = { collectReeveSnapshot };
