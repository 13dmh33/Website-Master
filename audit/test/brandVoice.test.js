import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lintBrandVoice } from '../lib/brandVoice.js';

test('lintBrandVoice passes clean sentence-case copy with no violations', () => {
  const text = 'Your site loads slowly on mobile, which likely costs you after-hours calls.\n\n## A quick note on your homepage\n\nDave';
  assert.deepEqual(lintBrandVoice(text), []);
});

test('lintBrandVoice flags emojis', () => {
  const violations = lintBrandVoice('Your site looks great! 🎉');
  assert.ok(violations.some((v) => v.includes('emoji')));
});

test('lintBrandVoice flags the word "bot"', () => {
  const violations = lintBrandVoice('Nora is a bot that answers your calls.');
  assert.ok(violations.some((v) => v.includes('bot')));
});

test('lintBrandVoice flags "business days"', () => {
  const violations = lintBrandVoice('We can have this live in 3 business days.');
  assert.ok(violations.some((v) => v.includes('business day')));
});

test('lintBrandVoice flags a Title Case heading', () => {
  const violations = lintBrandVoice('## Your Website Needs Some Love\n\nBody text here.');
  assert.ok(violations.some((v) => v.includes('Title Case')));
});

test('lintBrandVoice allows a sentence-case heading', () => {
  const violations = lintBrandVoice('## your website needs some love\n\nBody text here.');
  assert.equal(violations.filter((v) => v.includes('Title Case')).length, 0);
});
