'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCustomerFacingText, checkSourceForHardcodedName } = require('../lib/brand-lint');

test('checkCustomerFacingText — clean text produces no findings', () => {
  assert.deepEqual(checkCustomerFacingText('A plan for Acme Plumbing. Here is what I recommend.'), []);
});

test('checkCustomerFacingText — flags an emoji', () => {
  const findings = checkCustomerFacingText('Great news! 🎉');
  assert.equal(findings.length, 1);
  assert.match(findings[0], /emoji/);
});

test('checkCustomerFacingText — flags standalone "bot" but not "robot" or "boot"', () => {
  assert.equal(checkCustomerFacingText('Our bot will help you').length, 1);
  assert.equal(checkCustomerFacingText('Our robot arm').length, 0);
  assert.equal(checkCustomerFacingText('New boots in stock').length, 0);
});

test('checkCustomerFacingText — flags "business days" and "business day"', () => {
  assert.equal(checkCustomerFacingText('Ships in 3 business days').length, 1);
  assert.equal(checkCustomerFacingText('One business day turnaround').length, 1);
});

test('checkSourceForHardcodedName — flags a literal founder name in actual code', () => {
  assert.equal(checkSourceForHardcodedName('const signature = "Dave";').length, 1);
  assert.equal(checkSourceForHardcodedName('const html = `Signed, David Hettinger`;').length, 1);
});

test('checkSourceForHardcodedName — does not flag env-var-driven signing', () => {
  assert.equal(checkSourceForHardcodedName('const signatureName = process.env.SIGNATURE_NAME;').length, 0);
});

test('checkSourceForHardcodedName — ignores comments, only checks live code', () => {
  assert.equal(checkSourceForHardcodedName('// From Dave, explaining the field below\nconst x = 1;').length, 0);
  assert.equal(checkSourceForHardcodedName('/* Dave\'s own notes */\nconst y = 2;').length, 0);
});
