'use strict';
/**
 * Regression tests for Scout's monthly budget guard.
 *
 * The bug these lock down: `--budget` used to skip the whole monthly check.
 * Because scripts/lead-gen.sh — the documented one-command pipeline — passes
 * `--budget 0.25` by default, the $10/mo Outscraper cap was unenforceable
 * through the repo's own recommended entry point, and the month never rolled.
 * Observed live: config/scout-config.json sat at "2026-06" holding $0.142
 * accumulated across BOTH June and July, then the first non-budget run
 * "detected a new month" and zeroed July's real spend.
 */

const test = require('node:test');
const assert = require('node:assert');
const { rollMonthIfNeeded, checkBudget, currentMonth } = require('../scout');

function cfg(over = {}) {
  return {
    monthly_cap: 10, cost_per_result: 0.001,
    current_month: currentMonth(), spent_this_month: 0, ...over,
  };
}

test('rolls the spend counter when the month changes', () => {
  const c = cfg({ current_month: '2026-06', spent_this_month: 4.2 });
  rollMonthIfNeeded(c);
  assert.equal(c.current_month, currentMonth());
  assert.equal(c.spent_this_month, 0);
});

test('does not roll — or zero real spend — within the same month', () => {
  const c = cfg({ spent_this_month: 4.2 });
  rollMonthIfNeeded(c);
  assert.equal(c.spent_this_month, 4.2, 'same-month spend must survive');
});

test('returns null when the run fits inside the remaining monthly budget', () => {
  const c = cfg({ spent_this_month: 1 });
  assert.equal(checkBudget(c, 0.25), null, 'no capping needed');
});

test('caps the run down to whatever monthly budget remains', () => {
  // $9.90 spent of $10 => $0.10 left => 100 results at $0.001 each.
  const c = cfg({ spent_this_month: 9.9 });
  assert.equal(checkBudget(c, 5.0), 100);
});

test('checkBudget rolls the month itself, so a stale month cannot mask spend', () => {
  const c = cfg({ current_month: '2026-06', spent_this_month: 9.99 });
  // After the roll this is a fresh month, so a large run is affordable again.
  assert.equal(checkBudget(c, 0.25), null);
  assert.equal(c.spent_this_month, 0);
});
