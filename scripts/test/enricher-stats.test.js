'use strict';
/**
 * Enricher cumulative hit-rate persistence (closes the documented backlog item:
 * per-run found/no_match/errors were printed but never saved, so Apollo's real
 * success rate was invisible over time).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateEnricherStats } = require('../enricher.js');

test('updateEnricherStats — seeds stats on first run and computes hit rate', () => {
  const cfg = {};
  const s = updateEnricherStats(cfg, { found: 3, noMatch: 1, errors: 0 });
  assert.equal(s.found, 3);
  assert.equal(s.no_match, 1);
  assert.equal(s.attempted, 4);
  assert.equal(s.runs, 1);
  assert.equal(s.hit_rate_pct, 75); // 3 / (3+1)
  assert.equal(cfg.stats, s); // persisted onto cfg
});

test('updateEnricherStats — accumulates across runs', () => {
  const cfg = {};
  updateEnricherStats(cfg, { found: 3, noMatch: 1, errors: 0 });
  const s = updateEnricherStats(cfg, { found: 1, noMatch: 3, errors: 2 });
  assert.equal(s.found, 4);
  assert.equal(s.no_match, 4);
  assert.equal(s.runs, 2);
  assert.equal(s.hit_rate_pct, 50); // 4 / (4+4)
  assert.equal(s.attempted, 10);    // 4 + 4 matched/no-match + 2 errors
});

test('updateEnricherStats — errors are excluded from the hit-rate denominator', () => {
  const cfg = {};
  const s = updateEnricherStats(cfg, { found: 2, noMatch: 0, errors: 8 });
  assert.equal(s.hit_rate_pct, 100); // 2 / (2+0), errors ignored in rate
  assert.equal(s.errors, 8);
});

test('updateEnricherStats — hit rate is null when nothing was decided yet', () => {
  const cfg = {};
  const s = updateEnricherStats(cfg, { found: 0, noMatch: 0, errors: 3 });
  assert.equal(s.hit_rate_pct, null);
});

test('updateEnricherStats — missing counters default to 0, never NaN', () => {
  const cfg = {};
  const s = updateEnricherStats(cfg, {});
  assert.equal(s.found, 0);
  assert.equal(s.runs, 1);
  assert.equal(s.hit_rate_pct, null);
});
