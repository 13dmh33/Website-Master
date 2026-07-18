'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLeadId, buildOpenRow, TRANSPARENT_GIF_BASE64 } = require('../lib/proposal/open-pixel');
const { renderProposal } = require('../lib/proposal/template');

test('extractLeadId — returns the leadId when present', () => {
  assert.equal(extractLeadId({ leadId: 'L1' }), 'L1');
});

test('extractLeadId — returns null (never throws) for missing/empty/malformed input', () => {
  assert.equal(extractLeadId({}), null);
  assert.equal(extractLeadId({ leadId: '' }), null);
  assert.equal(extractLeadId(null), null);
  assert.equal(extractLeadId(undefined), null);
});

test('buildOpenRow — shape matches OPENS_HEADER order', () => {
  const row = buildOpenRow('L1', 'Mozilla/5.0');
  assert.equal(row.length, 3);
  assert.equal(row[1], 'L1');
  assert.equal(row[2], 'Mozilla/5.0');
  assert.ok(row[0]); // timestamp
});

test('buildOpenRow — tolerates a missing userAgent', () => {
  const row = buildOpenRow('L1', undefined);
  assert.equal(row[2], '');
});

test('TRANSPARENT_GIF_BASE64 — decodes to a valid, tiny GIF', () => {
  const buf = Buffer.from(TRANSPARENT_GIF_BASE64, 'base64');
  assert.equal(buf.slice(0, 3).toString('ascii'), 'GIF');
  assert.ok(buf.length < 100);
});

test('renderProposal — omits the pixel <img> entirely when trackingPixelUrl is not provided', () => {
  const html = renderProposal({
    input: { leadId: 'L1', trade: 'plumber', painPoint: 'x', package: 'starter' },
    businessName: 'Acme', signatureName: 'Alex',
  });
  assert.ok(!html.includes('<img'));
});

test('renderProposal — embeds the pixel as a hidden 1x1 image when trackingPixelUrl is provided', () => {
  const html = renderProposal({
    input: { leadId: 'L1', trade: 'plumber', painPoint: 'x', package: 'starter' },
    businessName: 'Acme', signatureName: 'Alex',
    trackingPixelUrl: 'https://trevoadvisors.com/.netlify/functions/proposal-open?leadId=L1',
  });
  assert.ok(html.includes('<img src="https://trevoadvisors.com/.netlify/functions/proposal-open?leadId=L1" width="1" height="1"'));
  assert.ok(html.includes('display:none'));
});
