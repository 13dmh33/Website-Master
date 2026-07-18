'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderProposal, usd } = require('../lib/proposal/template');

function baseInput(overrides = {}) {
  return {
    leadId: 'lead-1', trade: 'plumber', painPoint: 'Missing after-hours calls',
    package: 'starter', ...overrides,
  };
}

test('usd — formats with thousands separator, no decimals', () => {
  assert.equal(usd(497), '$497');
  assert.equal(usd(1200), '$1,200');
});

test('renderProposal — total for starter is just the setup fee, no monthly row', () => {
  const html = renderProposal({ input: baseInput(), businessName: 'Acme Plumbing', signatureName: 'Alex' });
  assert.ok(html.includes('$100'));
  assert.ok(!html.includes('/mo'), 'starter has no monthly component');
});

test('renderProposal — growth shows both setup total and a separate monthly line', () => {
  const html = renderProposal({ input: baseInput({ package: 'growth' }), businessName: 'Acme Plumbing', signatureName: 'Alex' });
  assert.ok(html.includes('$497'));
  assert.ok(html.includes('$147/mo'));
  assert.ok(html.includes('Due to start'));
});

test('renderProposal — custom line items add to the due-today total, not the monthly', () => {
  const input = baseInput({ package: 'growth', customLineItems: [{ label: 'Rush setup', amountUsd: 50 }] });
  const html = renderProposal({ input, businessName: 'Acme Plumbing', signatureName: 'Alex' });
  assert.ok(html.includes('Rush setup'));
  assert.ok(html.includes('$547'), 'due-today total should be 497 + 50');
});

test('renderProposal — includes the pain point verbatim and the signature name passed in', () => {
  const html = renderProposal({ input: baseInput({ painPoint: 'Specific thing they said' }), businessName: 'Acme', signatureName: 'Jordan' });
  assert.ok(html.includes('Specific thing they said'));
  assert.ok(html.includes('— Jordan'));
});

test('renderProposal — no stripeUrl means a pending CTA, not a broken link', () => {
  const html = renderProposal({ input: baseInput(), businessName: 'Acme', signatureName: 'Alex' });
  assert.ok(html.includes('Payment link pending'));
  assert.ok(!html.includes('href=""'));
});

test('renderProposal — brand compliance: no emojis, sentence-case headers, "AI agent" not "bot"', () => {
  const html = renderProposal({ input: baseInput({ package: 'pro' }), businessName: 'Acme', signatureName: 'Alex' });
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiPattern.test(html), false);
  assert.equal(/\bbot\b/i.test(html), false);
  assert.equal(/business days?/i.test(html), false);
  const headers = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m => m[1]);
  for (const h of headers) {
    assert.equal(h, h[0] + h.slice(1), `header "${h}" is unexpectedly transformed`);
    assert.ok(!/^[A-Z\s]+$/.test(h) || h.length <= 3, `header "${h}" looks like it might be all-caps`);
  }
});
