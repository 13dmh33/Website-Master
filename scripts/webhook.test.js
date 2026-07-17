#!/usr/bin/env node
/**
 * Unit tests for webhook inbound-SMS classification routing (no server, no network).
 * Run: node scripts/webhook.test.js
 */
'use strict';

const assert = require('assert');
const { classifyInbound, normalizePhone } = require('./webhook');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const st = body => classifyInbound(body).status;

console.log('\nwebhook — inbound SMS routing');
console.log('─'.repeat(56));

// ── opt-outs → unsubscribed (the core fix) ───────────────────────────────────

test('STOP keyword → unsubscribed', () => {
  const r = classifyInbound('STOP');
  assert.strictEqual(r.status, 'unsubscribed');
  assert.strictEqual(r.intent, 'stop');
});

test('"Not interested" → unsubscribed (was wrongly positive before)', () => {
  assert.strictEqual(st('Not interested'), 'unsubscribed');
});

test('"already have a website" → unsubscribed', () => {
  assert.strictEqual(st('We already have a website, thanks'), 'unsubscribed');
});

test('"take me off your list" → unsubscribed', () => {
  assert.strictEqual(st('please take me off your list'), 'unsubscribed');
});

// ── objection → on_hold (no booking reply) ───────────────────────────────────

test('"not right now, maybe in the fall" → on_hold', () => {
  assert.strictEqual(st('not right now, maybe in the fall'), 'on_hold');
});

test('"too busy this season" → on_hold', () => {
  assert.strictEqual(st('too busy this season, check back later'), 'on_hold');
});

// ── genuine interest → positive (books via mobile.js) ────────────────────────

test('"how much does it cost?" → positive', () => {
  assert.strictEqual(st('how much does it cost?'), 'positive');
});

test('"yes send me the demo" → positive', () => {
  assert.strictEqual(st('yes please send me the demo'), 'positive');
});

test('short "Ok" → positive (never drop a warm reply)', () => {
  assert.strictEqual(st('Ok'), 'positive');
});

test('ambiguous neutral reply falls back to positive, never dropped', () => {
  // A longer message with no clear signal — keep as positive rather than ignore.
  assert.strictEqual(st('I saw your message about the site earlier today'), 'positive');
});

// ── STOP fast-path is case/space tolerant ────────────────────────────────────

test('"stop" lowercase and "  STOP  " padded both unsubscribe', () => {
  assert.strictEqual(st('stop'), 'unsubscribed');
  assert.strictEqual(st('  STOP  '), 'unsubscribed');
});

// ── phone normalization (unchanged helper, guard against regressions) ────────

test('normalizePhone keeps the last 10 digits', () => {
  assert.strictEqual(normalizePhone('+1 (720) 555-0142'), '7205550142');
  assert.strictEqual(normalizePhone('720.555.0142'), '7205550142');
});

console.log('─'.repeat(56));
console.log(`${passed} passing${process.exitCode ? ' (with failures)' : ''}\n`);
