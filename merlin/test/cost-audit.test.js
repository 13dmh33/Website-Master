'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { costPerOutcome, buildCostAudit, currentMonth } = require('../lib/cost-audit');

test('costPerOutcome — returns null, never a fabricated number, when outcomeCount is zero', () => {
  assert.equal(costPerOutcome(50, 0), null);
  assert.equal(costPerOutcome(50, null), null);
  assert.equal(costPerOutcome(50, undefined), null);
});

test('costPerOutcome — divides correctly when outcomeCount is positive', () => {
  assert.equal(costPerOutcome(100, 4), 25);
});

test('currentMonth — matches YYYY-MM shape', () => {
  assert.match(currentMonth(), /^\d{4}-\d{2}$/);
});

test('buildCostAudit — never throws on an empty funnel, reports costPerOutcome as n/a not $0', () => {
  const audit = buildCostAudit({ funnel: { cumulativeReached: { hot: 0, replied: 0 } } });
  assert.equal(audit.costPerOutcomeUsd, null);
  assert.match(audit.costPerOutcomeNote, /n\/a/);
});

test('buildCostAudit — includes projections and assumptions arrays, never empty', () => {
  const audit = buildCostAudit({ funnel: { cumulativeReached: { hot: 0, replied: 0 } } });
  assert.ok(audit.projections.length >= 2);
  assert.ok(audit.assumptions.length >= 1);
  assert.ok(audit.projections.every(p => 'note' in p && 'active' in p), 'every projection is labeled, not a bare number');
});

test('buildCostAudit — live smoke test against the real repo', () => {
  const { computeFunnel } = require('../../scripts/lib/funnel');
  const state = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'state.json'), 'utf8'));
  const funnel = computeFunnel(state.queue);
  const audit = buildCostAudit({ funnel });
  assert.ok(typeof audit.actualTotalUsd === 'number');
  assert.ok(audit.month === currentMonth());
});
