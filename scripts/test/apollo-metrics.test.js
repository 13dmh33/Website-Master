const test = require('node:test');
const assert = require('node:assert/strict');

const { computeApolloMetrics, APOLLO_PER_CREDIT_USD } = require('../lib/apollo-metrics');

test('computeApolloMetrics — ignores leads Enricher never touched', () => {
  const leads = [
    { business_name: 'Untouched Co' }, // no apolloAttempted field at all
    { business_name: 'Also untouched', apolloAttempted: undefined },
  ];
  const m = computeApolloMetrics(leads);
  assert.equal(m.attempted, 0);
  assert.equal(m.hitRatePct, null);
  assert.equal(m.costPerHitUsd, null);
});

test('computeApolloMetrics — counts hits, misses, hit rate, and cost correctly', () => {
  const leads = [
    { apolloAttempted: true, apolloHit: true, apolloCreditSpent: 1 },
    { apolloAttempted: true, apolloHit: true, apolloCreditSpent: 1 },
    { apolloAttempted: true, apolloHit: false, apolloCreditSpent: 0 },
    { apolloAttempted: true, apolloHit: false, apolloCreditSpent: 0 },
  ];
  const m = computeApolloMetrics(leads);
  assert.equal(m.attempted, 4);
  assert.equal(m.hits, 2);
  assert.equal(m.misses, 2);
  assert.equal(m.hitRatePct, 50);
  assert.equal(m.creditsSpent, 2);
  assert.equal(m.costUsd, parseFloat((2 * APOLLO_PER_CREDIT_USD).toFixed(4)));
  assert.equal(m.costPerHitUsd, parseFloat(((2 * APOLLO_PER_CREDIT_USD) / 2).toFixed(4)));
});

test('computeApolloMetrics — 100% miss rate never divides by zero for cost-per-hit', () => {
  const leads = [
    { apolloAttempted: true, apolloHit: false, apolloCreditSpent: 0 },
    { apolloAttempted: true, apolloHit: false, apolloCreditSpent: 0 },
  ];
  const m = computeApolloMetrics(leads);
  assert.equal(m.hitRatePct, 0);
  assert.equal(m.costPerHitUsd, null);
});

test('computeApolloMetrics — empty input returns zeroed, non-crashing shape', () => {
  const m = computeApolloMetrics([]);
  assert.equal(m.attempted, 0);
  assert.equal(m.hits, 0);
  assert.equal(m.misses, 0);
  assert.equal(m.hitRatePct, null);
  assert.equal(m.creditsSpent, 0);
  assert.equal(m.costUsd, 0);
  assert.equal(m.costPerHitUsd, null);
});
