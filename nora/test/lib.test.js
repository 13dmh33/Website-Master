'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { makeNormalizedMessage } = require('../lib/normalize');
const { isNoraLive, isChannelGateOpen, isLive } = require('../lib/gates');
const { dispatchOutbound, DRAFTS_DIR } = require('../lib/dispatch');
const { getConversation, saveConversation, conversationPath } = require('../lib/state');

test('makeNormalizedMessage — builds a valid message', () => {
  const msg = makeNormalizedMessage({
    customerId: 'c1', channel: 'sms', fromIdentity: '+17205551234',
    text: 'hi', conversationId: 'conv1',
  });
  assert.equal(msg.customerId, 'c1');
  assert.ok(msg.timestamp);
});

test('makeNormalizedMessage — throws on unknown channel', () => {
  assert.throws(() => makeNormalizedMessage({
    customerId: 'c1', channel: 'carrier_pigeon', fromIdentity: 'x', text: '', conversationId: 'c',
  }), /unknown channel/);
});

test('makeNormalizedMessage — throws on missing fromIdentity', () => {
  assert.throws(() => makeNormalizedMessage({
    customerId: 'c1', channel: 'sms', fromIdentity: '', text: '', conversationId: 'c',
  }), /fromIdentity/);
});

test('makeNormalizedMessage — allows empty text (missed call)', () => {
  const msg = makeNormalizedMessage({
    customerId: 'c1', channel: 'missed_call', fromIdentity: '+1720', text: '', conversationId: 'c',
  });
  assert.equal(msg.text, '');
});

test('gates — everything off by default', () => {
  delete process.env.NORA_LIVE;
  delete process.env.SMS_LIVE;
  assert.equal(isNoraLive(), false);
  assert.equal(isLive('sms'), false);
  assert.equal(isLive('missed_call'), false);
});

test('gates — missed_call needs only NORA_LIVE, sms needs both', () => {
  process.env.NORA_LIVE = 'true';
  assert.equal(isLive('missed_call'), true, 'missed_call has no per-channel gate');
  assert.equal(isLive('sms'), false, 'sms still gated by SMS_LIVE');
  process.env.SMS_LIVE = 'true';
  assert.equal(isLive('sms'), true);
  delete process.env.NORA_LIVE;
  delete process.env.SMS_LIVE;
});

test('gates — unknown channel throws', () => {
  assert.throws(() => isChannelGateOpen('carrier_pigeon'), /unknown channel/);
});

test('dispatchOutbound — writes a draft when gate is off, never calls sendFn', async () => {
  delete process.env.NORA_LIVE;
  let called = false;
  const result = await dispatchOutbound({
    customerId: 'test-dispatch-customer',
    channel: 'sms',
    payload: { to: '+1720', body: 'hello' },
    sendFn: async () => { called = true; return { sid: 'SHOULD_NOT_HAPPEN' }; },
  });
  assert.equal(called, false);
  assert.equal(result.mode, 'draft');
  assert.ok(fs.existsSync(result.ref));
  const draft = JSON.parse(fs.readFileSync(result.ref, 'utf8'));
  assert.equal(draft.body, 'hello');
  fs.rmSync(path.join(DRAFTS_DIR, 'test-dispatch-customer'), { recursive: true, force: true });
});

test('dispatchOutbound — calls sendFn when gate is live', async () => {
  process.env.NORA_LIVE = 'true';
  process.env.SMS_LIVE = 'true';
  let called = false;
  const result = await dispatchOutbound({
    customerId: 'test-dispatch-customer',
    channel: 'sms',
    payload: { to: '+1720', body: 'hello' },
    sendFn: async () => { called = true; return { sid: 'SM123' }; },
  });
  assert.equal(called, true);
  assert.equal(result.mode, 'live');
  assert.equal(result.ref, 'SM123');
  delete process.env.NORA_LIVE;
  delete process.env.SMS_LIVE;
});

test('conversation state — default record, then additive save preserves prior fields', () => {
  const customerId = 'test-state-customer';
  const conversationId = 'conv-abc';
  const fresh = getConversation(customerId, conversationId);
  assert.equal(fresh.offeringId, null);
  assert.equal(fresh.routingResolved, false);

  saveConversation({ ...fresh, channel: 'sms', offeringId: 'plumbing' });
  const reloaded = getConversation(customerId, conversationId);
  assert.equal(reloaded.channel, 'sms');
  assert.equal(reloaded.offeringId, 'plumbing');
  assert.equal(reloaded.status, 'open', 'untouched field survives the merge');

  saveConversation({ ...reloaded, routingResolved: true });
  const reloaded2 = getConversation(customerId, conversationId);
  assert.equal(reloaded2.offeringId, 'plumbing', 'earlier field still present after a later partial save');
  assert.equal(reloaded2.routingResolved, true);

  fs.rmSync(path.dirname(conversationPath(customerId, conversationId)), { recursive: true, force: true });
});
