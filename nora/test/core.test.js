'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isWithinBusinessHours } = require('../core/business-hours');
const { resolveOffering } = require('../core/routing');
const { detectTriggers } = require('../core/escalate');
const { decide } = require('../core/index');
const { loadConfig } = require('../config/load-config');
const { makeNormalizedMessage } = require('../lib/normalize');

function freshConversation(customerId, conversationId) {
  const now = new Date().toISOString();
  return {
    customerId, conversationId, channel: null, offeringId: null,
    routingResolved: false, qualifyIndex: 0, answers: [], status: 'open',
    escalated: false, createdAt: now, updatedAt: now,
  };
}

function msg(overrides) {
  return makeNormalizedMessage({
    customerId: 'c', channel: 'sms', fromIdentity: '+17205551234',
    text: '', conversationId: 'conv1', ...overrides,
  });
}

// ── business hours ──────────────────────────────────────────────────────────

test('isWithinBusinessHours — inside a Monday open window', () => {
  const hours = { timezone: 'America/Denver', days: { mon: ['08:00', '17:00'], tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
  // 2026-07-13 is a Monday; noon Denver in July (MDT, UTC-6) = 18:00 UTC.
  assert.equal(isWithinBusinessHours(hours, '2026-07-13T18:00:00Z'), true);
});

test('isWithinBusinessHours — outside hours on a closed day', () => {
  const hours = { timezone: 'America/Denver', days: { mon: ['08:00', '17:00'], tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
  // 2026-07-12 is a Sunday.
  assert.equal(isWithinBusinessHours(hours, '2026-07-12T18:00:00Z'), false);
});

test('isWithinBusinessHours — before opening on an open day', () => {
  const hours = { timezone: 'America/Denver', days: { mon: ['08:00', '17:00'], tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } };
  // 5am Denver Monday = 11:00 UTC.
  assert.equal(isWithinBusinessHours(hours, '2026-07-13T11:00:00Z'), false);
});

// ── routing ──────────────────────────────────────────────────────────────────

test('resolveOffering — single-offering customer always resolves, never a question', () => {
  const config = loadConfig('example-plumber-single');
  const conv = freshConversation(config.customerId, 'conv1');
  const result = resolveOffering(config, msg({ customerId: config.customerId, text: 'my sink is leaking' }), conv);
  assert.equal(result.resolved, true);
  assert.equal(result.offeringId, 'plumbing');
  assert.equal(result.question, null);
});

test('resolveOffering — multi-offering, ambiguous text asks exactly one question', () => {
  const config = loadConfig('example-plumbing-hvac-two-offering');
  const conv = freshConversation(config.customerId, 'conv1');
  const result = resolveOffering(config, msg({ customerId: config.customerId, text: 'need someone to come out' }), conv);
  assert.equal(result.resolved, false);
  assert.ok(result.question.includes('plumbing'));
  assert.ok(result.question.includes('heating and cooling'));
});

test('resolveOffering — multi-offering, clear text resolves without a question', () => {
  const config = loadConfig('example-plumbing-hvac-two-offering');
  const conv = freshConversation(config.customerId, 'conv1');
  const result = resolveOffering(config, msg({ customerId: config.customerId, text: 'my furnace is not heating the house' }), conv);
  assert.equal(result.resolved, true);
  assert.equal(result.offeringId, 'hvac');
});

// ── escalation ───────────────────────────────────────────────────────────────

test('detectTriggers — fires emergency only when declared and matched', () => {
  const config = loadConfig('example-plumber-single');
  const conv = freshConversation(config.customerId, 'conv1');
  const fired = detectTriggers(config, msg({ customerId: config.customerId, text: 'we have a burst pipe flooding the basement' }), conv);
  assert.deepEqual(fired, ['emergency']);
});

test('detectTriggers — does not fire an undeclared trigger', () => {
  const config = loadConfig('example-plumber-single'); // triggers: emergency, angry_customer only
  const conv = freshConversation(config.customerId, 'conv1');
  const fired = detectTriggers(config, msg({ customerId: config.customerId, text: 'let me talk to a manager please' }), conv);
  assert.deepEqual(fired, [], 'explicit_request is not declared for this customer');
});

// ── core.decide — single-offering conformance (Step 2 substitute proof) ──────
// No legacy implementation exists to diff byte-for-byte (see DISCOVERY.md).
// This instead proves the config-driven core matches what's already sold in
// templates.json's e6 copy: Nora "answers calls, qualifies the job, and
// books the appointment" — with zero routing overhead for a single-offering
// install, exactly as the scope doc requires.

test('core.decide — single-offering: missed call asks first qualify question directly, no routing step', () => {
  const config = loadConfig('example-plumber-single');
  const conv = freshConversation(config.customerId, 'conv1');
  const message = msg({ customerId: config.customerId, channel: 'missed_call', text: '', timestamp: '2026-07-13T18:00:00Z' });
  const { decision, conversation } = decide(message, config, conv);
  assert.equal(decision.action, 'ask_qualify_question');
  assert.equal(decision.replyText, config.offerings[0].qualifyQs[0]);
  assert.equal(conversation.offeringId, 'plumbing');
  assert.equal(conversation.routingResolved, true);
});

test('core.decide — single-offering: full qualify loop then books', () => {
  const config = loadConfig('example-plumber-single');
  let conv = freshConversation(config.customerId, 'conv-full');
  const qCount = config.offerings[0].qualifyQs.length;

  let message = msg({ customerId: config.customerId, channel: 'sms', text: 'leak under the sink', timestamp: '2026-07-13T18:00:00Z' });
  let result = decide(message, config, conv);
  assert.equal(result.decision.action, 'ask_qualify_question');
  conv = result.conversation;

  for (let i = 1; i < qCount; i++) {
    message = msg({ customerId: config.customerId, channel: 'sms', text: `answer ${i}`, timestamp: '2026-07-13T18:00:00Z' });
    result = decide(message, config, conv);
    assert.equal(result.decision.action, 'ask_qualify_question', `still qualifying at step ${i}`);
    conv = result.conversation;
  }

  message = msg({ customerId: config.customerId, channel: 'sms', text: 'final answer', timestamp: '2026-07-13T18:00:00Z' });
  result = decide(message, config, conv);
  assert.equal(result.decision.action, 'qualified_confirm_booking');
  assert.equal(result.decision.calendarId, 'cal_plumbing_default');
  assert.equal(result.conversation.answers.length, qCount);
});

test('core.decide — multi-offering: routes once, then qualifies with the resolved offering\'s questions', () => {
  const config = loadConfig('example-plumbing-hvac-two-offering');
  let conv = freshConversation(config.customerId, 'conv-multi');

  let message = msg({ customerId: config.customerId, channel: 'sms', text: 'need help', timestamp: '2026-07-13T18:00:00Z' });
  let result = decide(message, config, conv);
  assert.equal(result.decision.action, 'ask_routing_question');
  conv = result.conversation;
  assert.equal(conv.routingResolved, false);

  message = msg({ customerId: config.customerId, channel: 'sms', text: 'heating and cooling', timestamp: '2026-07-13T18:00:00Z' });
  result = decide(message, config, conv);
  assert.equal(result.decision.action, 'ask_qualify_question');
  assert.equal(result.decision.replyText, config.offerings[1].qualifyQs[0]);
  assert.equal(result.conversation.offeringId, 'hvac');
});

test('core.decide — escalation short-circuits routing/qualify immediately', () => {
  const config = loadConfig('example-plumber-single');
  const conv = freshConversation(config.customerId, 'conv-esc');
  const message = msg({ customerId: config.customerId, channel: 'sms', text: 'gas smell in the house, please help', timestamp: '2026-07-13T18:00:00Z' });
  const { decision, conversation } = decide(message, config, conv);
  assert.equal(decision.action, 'escalate');
  assert.deepEqual(decision.triggers, ['emergency']);
  assert.equal(conversation.status, 'escalated');
});

test('core.decide — after-hours capture_and_promise prepends notice only on the first turn', () => {
  const config = loadConfig('example-plumber-single');
  let conv = freshConversation(config.customerId, 'conv-ah');
  // Sunday — closed all day per the example config.
  let message = msg({ customerId: config.customerId, channel: 'sms', text: 'leak', timestamp: '2026-07-12T18:00:00Z' });
  let result = decide(message, config, conv);
  assert.ok(result.decision.replyText.startsWith("We're closed right now"));
  conv = result.conversation;

  message = msg({ customerId: config.customerId, channel: 'sms', text: 'still Sunday', timestamp: '2026-07-12T19:00:00Z' });
  result = decide(message, config, conv);
  assert.ok(!result.decision.replyText.startsWith("We're closed right now"), 'notice only shown once, on the first turn');
});
