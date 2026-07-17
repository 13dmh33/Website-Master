#!/usr/bin/env node
/**
 * Unit tests for the enricher lifetime-stats accumulator (no network, no Apollo).
 * Run: node scripts/enricher.test.js
 */
'use strict';

const assert = require('assert');
const { mergeStats } = require('./enricher');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('\nenricher — lifetime stats');
console.log('─'.repeat(56));

test('first run seeds lifetime totals + match rate', () => {
  const s = mergeStats(null, { found: 3, noMatch: 7, errors: 1, briefsUpgraded: 2, at: 'T1' });
  assert.deepStrictEqual(s.lifetime, { lookups: 10, found: 3, no_match: 7, errors: 1, briefs_upgraded: 2 });
  assert.strictEqual(s.match_rate_pct, 30);              // 3 / (3+7)
  assert.deepStrictEqual(s.last_run, { found: 3, no_match: 7, errors: 1, briefs_upgraded: 2, at: 'T1' });
});

test('second run accumulates and recomputes the rate', () => {
  const s1 = mergeStats(null, { found: 3, noMatch: 7, errors: 1, briefsUpgraded: 2, at: 'T1' });
  const s2 = mergeStats(s1, { found: 5, noMatch: 5, errors: 0, briefsUpgraded: 1, at: 'T2' });
  assert.strictEqual(s2.lifetime.found, 8);
  assert.strictEqual(s2.lifetime.no_match, 12);
  assert.strictEqual(s2.lifetime.lookups, 20);
  assert.strictEqual(s2.lifetime.errors, 1);
  assert.strictEqual(s2.match_rate_pct, 40);            // 8 / 20
  assert.strictEqual(s2.last_run.at, 'T2');
});

test('errors do not count toward the match-rate denominator', () => {
  const s = mergeStats(null, { found: 0, noMatch: 0, errors: 5, briefsUpgraded: 0, at: 'T' });
  assert.strictEqual(s.match_rate_pct, 0);              // no resolved lookups → 0, not NaN
  assert.strictEqual(s.lifetime.errors, 5);
  assert.strictEqual(s.lifetime.lookups, 0);
});

test('match rate rounds to one decimal', () => {
  const s = mergeStats(null, { found: 1, noMatch: 2, errors: 0, briefsUpgraded: 0, at: 'T' });
  assert.strictEqual(s.match_rate_pct, 33.3);          // 1/3
});

test('tolerates a legacy config with no stats block', () => {
  const s = mergeStats({}, { found: 2, noMatch: 0, errors: 0, briefsUpgraded: 0, at: 'T' });
  assert.strictEqual(s.lifetime.found, 2);
  assert.strictEqual(s.match_rate_pct, 100);
});

console.log('─'.repeat(56));
console.log(`${passed} passing${process.exitCode ? ' (with failures)' : ''}\n`);
