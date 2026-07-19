'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecisions } = require('../lib/decisions');

const FIXTURE = JSON.stringify({
  decisions: [
    {
      id: 'backlog-is-arithmetic',
      date: '2026-07-19',
      decision: 'The backlog is arithmetic.',
      supersedes: ['clear_send_backlog'],
      explains: ['checker_limit_elevated'],
    },
  ],
});

test('loadDecisions — supersedes maps a candidate id to its deciding record', () => {
  const d = loadDecisions(() => FIXTURE);
  assert.ok(d.isSuperseded('clear_send_backlog'));
  assert.equal(d.decisionFor('clear_send_backlog').id, 'backlog-is-arithmetic');
  assert.ok(!d.isSuperseded('some_other_candidate'));
});

test('loadDecisions — explains maps an integrity-flag id to its deciding record', () => {
  const d = loadDecisions(() => FIXTURE);
  assert.equal(d.explanationFor('checker_limit_elevated').id, 'backlog-is-arithmetic');
  assert.equal(d.explanationFor('unrelated_flag'), null);
});

test('loadDecisions — malformed json degrades to an empty decision set, never throws', () => {
  const d = loadDecisions(() => 'not json{');
  assert.equal(d.decisions.length, 0);
  assert.ok(!d.isSuperseded('anything'));
});

test('loadDecisions — the real merlin/decisions.json is valid and seeds the backlog decision', () => {
  const d = loadDecisions(); // real file
  assert.ok(d.isSuperseded('clear_send_backlog'), 'the shipped decisions.json must supersede clear_send_backlog');
});
