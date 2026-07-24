'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { emailComplianceStatus, buildFooter, appendFooter, assertEmailCompliant } = require('../lib/compliance');

const FULL = {
  physical_address: '1600 Pennsylvania Ave, Denver CO 80202',
  ad_disclosure: 'This is a commercial email advertising Trevo Advisors.',
  opt_out_line: 'Not interested? Reply "stop".',
  business_name: 'Trevo Advisors',
};
const NO_ADDRESS = { ...FULL, physical_address: '' };

test('emailComplianceStatus — fully configured is compliant with nothing missing', () => {
  const s = emailComplianceStatus(FULL);
  assert.equal(s.compliant, true);
  assert.deepEqual(s.missing, []);
});

test('emailComplianceStatus — blank physical address is the one blocker (#4), #3 and #5 satisfied', () => {
  const s = emailComplianceStatus(NO_ADDRESS);
  assert.equal(s.compliant, false);
  assert.equal(s.missing.length, 1);
  assert.match(s.missing[0], /#4/);
});

test('buildFooter — contains ad identification (#3), address (#4), and opt-out (#5)', () => {
  const footer = buildFooter(FULL);
  assert.match(footer, /commercial email advertising/);      // #3
  assert.match(footer, /1600 Pennsylvania Ave/);             // #4
  assert.match(footer, /Reply "stop"/);                      // #5
});

test('appendFooter — separates footer from body with a standard rule and keeps the body intact', () => {
  const out = appendFooter('Hey, quick pitch.', FULL);
  assert.match(out, /^Hey, quick pitch\./);
  assert.match(out, /\n--\n/);
  assert.match(out, /1600 Pennsylvania Ave/);
});

test('assertEmailCompliant — throws a clear, actionable error when the address is missing', () => {
  assert.throws(() => assertEmailCompliant(NO_ADDRESS), /BLOCKED by CAN-SPAM.*#4/s);
});

test('assertEmailCompliant — does not throw once fully configured', () => {
  assert.doesNotThrow(() => assertEmailCompliant(FULL));
});

test('the shipped config/compliance.json is fully compliant (#3, #4, #5 all present)', () => {
  const s = emailComplianceStatus(); // real file — address now filled in
  assert.equal(s.compliant, true, 'shipped config must satisfy all three CAN-SPAM footer requirements');
  assert.deepEqual(s.missing, []);
});
