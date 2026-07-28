'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../lib/planner');

test('getWeekNumber is a stable, monotonically increasing week index', () => {
  const w0 = planner.getWeekNumber(new Date('2026-07-27T00:00:00Z'));
  const w1 = planner.getWeekNumber(new Date('2026-08-03T00:00:00Z'));
  assert.equal(w1, w0 + 1);
});

test('pickTrevoFound alternates demo/agent weeks and stays within each list', () => {
  const even = planner.pickTrevoFound(10); // even → agent
  const odd  = planner.pickTrevoFound(11); // odd → demo
  assert.equal(even.kind, 'agent');
  assert.ok(planner.AGENTS.includes(even.item));
  assert.equal(odd.kind, 'demo');
  assert.ok(planner.DEMOS.includes(odd.item));
});

test('pickReelStyle cycles through all configured reel styles', () => {
  const seen = new Set();
  for (let w = 0; w < planner.REEL_STYLES.length; w++) seen.add(planner.pickReelStyle(w));
  assert.equal(seen.size, planner.REEL_STYLES.length);
  // full cycle repeats
  assert.equal(planner.pickReelStyle(0), planner.pickReelStyle(planner.REEL_STYLES.length));
});

test('resolveCalendarContext picks up the monthly reminder on the 1st', () => {
  const { primary } = planner.resolveCalendarContext(new Date('2026-06-01T12:00:00Z'));
  assert.ok(primary, 'expected an active calendar entry on the 1st of the month');
  assert.equal(primary.id, 'monthly-review-reminder');
});

test('resolveCalendarContext returns no primary entry on an ordinary mid-month date with no other rule active', () => {
  // pick a date unlikely to collide with any other configured rule
  const { primary, supplements } = planner.resolveCalendarContext(new Date('2026-06-15T12:00:00Z'));
  assert.equal(primary, null);
  assert.deepEqual(supplements, []);
});

test('buildWeekPlan returns the full expected shape', () => {
  const plan = planner.buildWeekPlan(new Date('2026-07-27T00:00:00Z'));
  assert.ok(typeof plan.weekNumber === 'number');
  assert.ok(typeof plan.captionNiche === 'string');
  assert.ok(typeof plan.reelNiche === 'string');
  assert.ok(planner.REEL_STYLES.includes(plan.reelStyle));
  assert.ok(['demo', 'agent'].includes(plan.trevoFound.kind));
  assert.ok('calendarContext' in plan);
});
