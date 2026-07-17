'use strict';
/**
 * apollo-metrics — pure computation over Enricher's additive
 * apolloAttempted/apolloHit/apolloCreditSpent fields (see DISCOVERY.md and
 * the Enricher instrumentation commit). Read-only: takes lead arrays in,
 * returns numbers out, touches no files itself.
 */

const APOLLO_PER_CREDIT_USD = 0.049; // matches scripts/cost-tracker.js's recordApollo()

function computeApolloMetrics(leads) {
  const attempted = leads.filter(l => l.apolloAttempted === true);
  const hits = attempted.filter(l => l.apolloHit === true);
  const misses = attempted.filter(l => l.apolloHit === false);
  const creditsSpent = attempted.reduce((sum, l) => sum + (l.apolloCreditSpent || 0), 0);
  const costUsd = parseFloat((creditsSpent * APOLLO_PER_CREDIT_USD).toFixed(4));
  const hitRatePct = attempted.length > 0
    ? parseFloat(((hits.length / attempted.length) * 100).toFixed(1))
    : null;
  const costPerHitUsd = hits.length > 0
    ? parseFloat((costUsd / hits.length).toFixed(4))
    : null;

  return {
    attempted: attempted.length,
    hits: hits.length,
    misses: misses.length,
    hitRatePct,
    creditsSpent,
    costUsd,
    costPerHitUsd,
  };
}

module.exports = { computeApolloMetrics, APOLLO_PER_CREDIT_USD };
