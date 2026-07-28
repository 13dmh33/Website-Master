'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../lib/calendar');

test('getActiveEntries matches the monthly_day rule on the 1st', () => {
  const entries = calendar.getActiveEntries(new Date('2026-09-01T12:00:00Z'));
  assert.ok(entries.some(e => e.id === 'monthly-review-reminder'));
});

test('getActiveEntries matches National Skilled Trades Day (first Wednesday in May)', () => {
  // 2026-05-06 is the first Wednesday of May 2026
  const entries = calendar.getActiveEntries(new Date('2026-05-04T12:00:00Z')); // Monday of that week
  assert.ok(entries.some(e => e.id === 'skilled-trades-day'));
});

test('getActiveEntries sorts by priority descending', () => {
  // Small Business Week (priority 7) and Skilled Trades Day (priority 8) don't
  // overlap by month, so instead just check general ordering behavior directly.
  const entries = calendar.getActiveEntries(new Date('2026-09-01T12:00:00Z'));
  for (let i = 1; i < entries.length; i++) {
    assert.ok((entries[i - 1].priority || 0) >= (entries[i].priority || 0));
  }
});

test('getActiveEntries returns [] for a date matching no rule', () => {
  const entries = calendar.getActiveEntries(new Date('2026-06-15T12:00:00Z'));
  assert.deepEqual(entries, []);
});

test('weekDates returns the Mon-Sun week containing the given date', () => {
  const days = calendar.weekDates(new Date('2026-07-29T00:00:00Z')); // a Wednesday
  assert.equal(days.length, 7);
  assert.equal(days[0].getDay(), 1); // Monday
  assert.equal(days[6].getDay(), 0); // Sunday
});
