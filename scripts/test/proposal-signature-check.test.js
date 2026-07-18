'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSignatureConfigured } = require('../lib/proposal/signature-check');

test('checkSignatureConfigured — ok for a real name', () => {
  assert.deepEqual(checkSignatureConfigured('Alex'), { ok: true });
});

test('checkSignatureConfigured — fails on undefined/empty', () => {
  assert.equal(checkSignatureConfigured(undefined).ok, false);
  assert.equal(checkSignatureConfigured('').ok, false);
  assert.equal(checkSignatureConfigured('   ').ok, false);
});

test('checkSignatureConfigured — fails on obvious placeholders, case-insensitive', () => {
  assert.equal(checkSignatureConfigured('Your Name').ok, false);
  assert.equal(checkSignatureConfigured('TODO').ok, false);
  assert.equal(checkSignatureConfigured('SIGNATURE_NAME').ok, false);
});

test('checkSignatureConfigured — never throws regardless of input type', () => {
  assert.doesNotThrow(() => checkSignatureConfigured(null));
  assert.doesNotThrow(() => checkSignatureConfigured(42));
});
