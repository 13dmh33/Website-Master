'use strict';
/**
 * Regression test for the send-time non-prospect gate.
 *
 * lead-quality.js has always known that supply houses, distributors and
 * big-box stores are not Trevo prospects, but the check only ran inside
 * contact-scraper. Non-prospects arriving by any other route — Scout,
 * sheet-import — sailed through Diagnoser and Checker and reached the send
 * queue. At the time of the fix, 8 checker-approved briefs were queued to be
 * pitched, including Ferguson (x2) and The Home Depot (x2).
 *
 * These assert the classifier behaviour the gate in pitcher.js / drip.js
 * depends on. If someone loosens isNonProspectBusiness, this fails loudly
 * rather than quietly resuming outreach to Fortune 50 hardware chains.
 */

const test = require('node:test');
const assert = require('node:assert');
const { isNonProspectBusiness } = require('../lib/lead-quality');

test('big-box retailers are not prospects', () => {
  // Verbatim business_name values from real approved briefs in queue/.
  assert.equal(isNonProspectBusiness('Home Services at The Home Depot'), true);
  assert.equal(isNonProspectBusiness("Lowe's Home Improvement"), true);
});

test('distributors and supply houses are not prospects', () => {
  assert.equal(isNonProspectBusiness('Ferguson'), true);
  assert.equal(isNonProspectBusiness('Pace Plumbing & Supply Co'), true);
  assert.equal(isNonProspectBusiness('City Supply Company'), true);
  assert.equal(isNonProspectBusiness('Chesley Plumbing Supply'), true);
  assert.equal(isNonProspectBusiness('Stokes Hardware & Supply'), true);
});

test('real contractors are still prospects — the gate must not over-reach', () => {
  // Every one of these is a real lead currently in the pipeline.
  assert.equal(isNonProspectBusiness('Juan In A Million Handyman Services'), false);
  assert.equal(isNonProspectBusiness('Best Handyman 702'), false);
  assert.equal(isNonProspectBusiness("Bill's Plumbing & Drain Service"), false);
  assert.equal(isNonProspectBusiness('Rocky Mountain Plumbing Services LLC'), false);
  // "Supply" inside a longer trade name must not trip the ends-with-Supply rule.
  assert.equal(isNonProspectBusiness('Supply Creek Plumbing and Heating'), false);
});

test('empty or missing names are treated as prospects, not silently dropped', () => {
  assert.equal(isNonProspectBusiness(''), false);
  assert.equal(isNonProspectBusiness(null), false);
  assert.equal(isNonProspectBusiness(undefined), false);
});
