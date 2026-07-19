'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { twilioCallbackToNormalizedMessage } = require('../channels/missed_call/adapter');
const missedCallResponder = require('../channels/missed_call/responder');
const { twilioSmsToNormalizedMessage } = require('../channels/sms/adapter');
const smsResponder = require('../channels/sms/responder');
const { parsePath, handleRoute } = require('../server');
const { DRAFTS_DIR } = require('../lib/dispatch');
const { CONVERSATIONS_DIR } = require('../lib/state');
const { loadConfig } = require('../config/load-config');

function cleanupCustomerDirs(customerId) {
  fs.rmSync(path.join(DRAFTS_DIR, customerId), { recursive: true, force: true });
  fs.rmSync(path.join(CONVERSATIONS_DIR, customerId), { recursive: true, force: true });
}

// ── missed-call adapter ───────────────────────────────────────────────────────

test('twilioCallbackToNormalizedMessage — no-answer becomes a missed_call message', () => {
  const msg = twilioCallbackToNormalizedMessage('c1', { From: '+17205551234', CallStatus: 'no-answer' });
  assert.equal(msg.channel, 'missed_call');
  assert.equal(msg.fromIdentity, '+17205551234');
  assert.equal(msg.conversationId, '+17205551234');
});

test('twilioCallbackToNormalizedMessage — completed (answered) returns null', () => {
  const msg = twilioCallbackToNormalizedMessage('c1', { From: '+17205551234', CallStatus: 'completed' });
  assert.equal(msg, null);
});

// ── sms adapter ────────────────────────────────────────────────────────────────

test('twilioSmsToNormalizedMessage — builds a normalized message from Twilio params', () => {
  const msg = twilioSmsToNormalizedMessage('c1', { From: '+17205551234', Body: '  leak under the sink  ' });
  assert.equal(msg.channel, 'sms');
  assert.equal(msg.text, 'leak under the sink');
});

// ── responders — draft path (gates off) ─────────────────────────────────────────

test('missed_call responder — writes a draft when NORA_LIVE is off', async () => {
  delete process.env.NORA_LIVE;
  const config = loadConfig('example-plumber-single');
  const result = await missedCallResponder.respond({
    config, decision: { replyText: 'hi there' }, toIdentity: '+17205551234', twilioCreds: {},
  });
  assert.equal(result.mode, 'draft');
  cleanupCustomerDirs(config.customerId);
});

test('sms responder — writes a draft when SMS_LIVE is off', async () => {
  delete process.env.NORA_LIVE;
  delete process.env.SMS_LIVE;
  const config = loadConfig('example-plumber-single');
  const result = await smsResponder.respond({
    config, decision: { replyText: 'hi there' }, toIdentity: '+17205551234', twilioCreds: {},
  });
  assert.equal(result.mode, 'draft');
  cleanupCustomerDirs(config.customerId);
});

// ── server route parsing ─────────────────────────────────────────────────────

test('parsePath — matches missed-call and sms routes', () => {
  assert.deepEqual(parsePath('/nora/acme/missed-call'), { customerId: 'acme', route: 'missed-call' });
  assert.deepEqual(parsePath('/nora/acme/sms'), { customerId: 'acme', route: 'sms' });
});

test('parsePath — rejects unknown routes and malformed paths', () => {
  assert.equal(parsePath('/nora/acme/web-chat'), null);
  assert.equal(parsePath('/nora/acme'), null);
  assert.equal(parsePath('/'), null);
});

// ── end-to-end through handleRoute (gates off — draft-only, no real Twilio calls) ──

test('handleRoute — missed call then SMS replies walk through routing-free qualify-and-book', async () => {
  delete process.env.NORA_LIVE;
  const customerId = 'example-plumber-single';
  const phone = '+17205559999';
  cleanupCustomerDirs(customerId);

  await handleRoute({ customerId, route: 'missed-call' }, { From: phone, CallStatus: 'no-answer' });
  let convPath = path.join(CONVERSATIONS_DIR, customerId, `${phone}.json`);
  assert.ok(fs.existsSync(convPath));
  let conv = JSON.parse(fs.readFileSync(convPath, 'utf8'));
  assert.equal(conv.offeringId, 'plumbing');
  assert.equal(conv.qualifyIndex, 0);
  assert.ok(conv.pendingQuestion);

  const config = loadConfig(customerId);
  const totalQs = config.offerings[0].qualifyQs.length;
  for (let i = 0; i < totalQs; i++) {
    await handleRoute({ customerId, route: 'sms' }, { From: phone, Body: `answer ${i}` });
  }
  conv = JSON.parse(fs.readFileSync(convPath, 'utf8'));
  assert.equal(conv.status, 'qualified');
  assert.equal(conv.answers.length, totalQs);

  cleanupCustomerDirs(customerId);
});

test('handleRoute — an answered call (CallStatus completed) is a no-op, no conversation created', async () => {
  const customerId = 'example-plumber-single';
  const phone = '+17205558888';
  cleanupCustomerDirs(customerId);
  await handleRoute({ customerId, route: 'missed-call' }, { From: phone, CallStatus: 'completed' });
  const convPath = path.join(CONVERSATIONS_DIR, customerId, `${phone}.json`);
  assert.equal(fs.existsSync(convPath), false);
});
