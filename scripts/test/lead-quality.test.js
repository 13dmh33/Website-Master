'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlaceholderEmail, isNonProspectBusiness } = require('../lib/lead-quality');

test('isPlaceholderEmail — rejects the real Wix default that slipped through (info@mysite.com)', () => {
  assert.equal(isPlaceholderEmail('info@mysite.com'), true);
  assert.equal(isPlaceholderEmail('you@yourdomain.com'), true);
  assert.equal(isPlaceholderEmail('test@example.com'), true);
  assert.equal(isPlaceholderEmail('name@company.com'), true);
});

test('isPlaceholderEmail — accepts real business inboxes', () => {
  assert.equal(isPlaceholderEmail('service@austinplumbing.com'), false);
  assert.equal(isPlaceholderEmail('lpplumbing18@gmail.com'), false);
  assert.equal(isPlaceholderEmail('bill@ezflowplumbingtexas.com'), false);
});

test('isPlaceholderEmail — malformed / empty is treated as junk', () => {
  assert.equal(isPlaceholderEmail(''), true);
  assert.equal(isPlaceholderEmail('not-an-email'), true);
  assert.equal(isPlaceholderEmail(null), true);
});

test('isNonProspectBusiness — flags the real supply houses excluded by hand on 2026-07-26', () => {
  for (const name of [
    'Ferguson Plumbing Supply', 'Ferguson Home', 'Josco Supply & Showroom',
    'Moore Supply Co.', 'Winsupply of Austin', 'Young Tile International',
  ]) {
    assert.equal(isNonProspectBusiness(name), true, `${name} should be flagged non-prospect`);
  }
});

test('isNonProspectBusiness — does NOT flag real contractor prospects', () => {
  for (const name of [
    'L & P Plumbing, LLC', 'Austin Plumbing', 'EZ Flow Plumbing', 'Redbud Plumbing',
    'Sustainable Plumbing & Air', 'Adept Plumbing', 'Gardenhouse Plumbing',
  ]) {
    assert.equal(isNonProspectBusiness(name), false, `${name} is a real prospect, must not be flagged`);
  }
});

test('isNonProspectBusiness — tolerates empty/junk input', () => {
  assert.equal(isNonProspectBusiness(''), false);
  assert.equal(isNonProspectBusiness(null), false);
});
