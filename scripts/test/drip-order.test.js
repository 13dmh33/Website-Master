'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { orderDripQueue } = require('../lib/drip-order');

const item = (channel, daysOverdue, id) => ({ channel, daysOverdue, leadId: id });

test('orderDripQueue — one channel cannot consume the whole daily budget', () => {
  // The real 2026-07-31 shape: far more sms due than email, and the daily
  // limit of 20 sliced off the front of an unordered queue, so every slot went
  // to sms — a channel that has never delivered — and zero email follow-ups
  // went out.
  const queue = [
    ...Array.from({ length: 72 }, (_, i) => item('sms', 10, `s${i}`)),
    ...Array.from({ length: 58 }, (_, i) => item('email', 10, `e${i}`)),
  ];
  const firstTwenty = orderDripQueue(queue).slice(0, 20);
  const emails = firstTwenty.filter(x => x.channel === 'email').length;
  assert.ok(emails >= 10, `email should get roughly half the budget, got ${emails}`);
  assert.ok(emails <= 10, 'and should not take more than its share either');
});

test('orderDripQueue — most overdue goes first within a channel', () => {
  const ordered = orderDripQueue([
    item('email', 1, 'fresh'),
    item('email', 30, 'oldest'),
    item('email', 12, 'middle'),
  ]);
  assert.deepEqual(ordered.map(x => x.leadId), ['oldest', 'middle', 'fresh']);
});

test('orderDripQueue — a single channel still drains in overdue order', () => {
  const ordered = orderDripQueue([item('sms', 2, 'a'), item('sms', 9, 'b')]);
  assert.deepEqual(ordered.map(x => x.leadId), ['b', 'a']);
});

test('orderDripQueue — never drops or duplicates an item', () => {
  const queue = [
    item('email', 5, 'e1'), item('sms', 1, 's1'), item('email', 2, 'e2'),
    item('sms', 8, 's2'), item('sms', 3, 's3'),
  ];
  const ordered = orderDripQueue(queue);
  assert.equal(ordered.length, queue.length, 'same count in as out');
  assert.deepEqual(
    ordered.map(x => x.leadId).sort(),
    queue.map(x => x.leadId).sort(),
    'exactly the same items, only reordered',
  );
});

test('orderDripQueue — tolerates an empty queue, missing daysOverdue, and an absent channel', () => {
  assert.deepEqual(orderDripQueue([]), []);
  assert.deepEqual(orderDripQueue(undefined), []);
  const ordered = orderDripQueue([{ leadId: 'x' }, { channel: 'email', leadId: 'y' }]);
  assert.equal(ordered.length, 2, 'items with no channel are still returned, not silently dropped');
});

test('orderDripQueue — encodes no assumption about which channel is healthy', () => {
  // SMS becomes deliverable the day A2P clears; the ordering must not need
  // editing then. With equal volume and equal urgency, neither channel wins.
  const ordered = orderDripQueue([item('sms', 5, 's1'), item('email', 5, 'e1')]);
  assert.equal(ordered.length, 2);
  assert.notEqual(ordered[0].channel, ordered[1].channel, 'it alternates rather than preferring one');
});
