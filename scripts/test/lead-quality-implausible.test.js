'use strict';
/**
 * Regression tests for isImplausibleBusinessEmail — the filter that stops
 * contact-scraper adopting third-party boilerplate as a lead's email.
 *
 * Every REJECT case below is a real address harvested by a real run
 * (2026-07-26 Austin, 2026-07-28 Colorado Springs). Every KEEP case is a real
 * address from the same runs that must survive — the filter is worthless if it
 * also drops genuine contractors.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  isImplausibleBusinessEmail,
  isBoilerplateAuthorEmail,
} = require('../lib/lead-quality');

test('rejects font-foundry and theme-author addresses scraped from page furniture', () => {
  // Astigmatic One Eye — font foundry, appears in Google Fonts CSS headers.
  assert.equal(isImplausibleBusinessEmail('astigma@astigmatic.com', 'aplussewerdp.com', 'A Plus Sewer, Drain and Plumbing'), true);
  // Pablo Impallari — type designer (Lobster/Playfair). On Gmail, so only the
  // author denylist can catch it; domain heuristics never would.
  assert.equal(isImplausibleBusinessEmail('impallari@gmail.com', 'waterheaterprosco.com', 'Water Heater Pros'), true);
  // WordPress theme demo author.
  assert.equal(isImplausibleBusinessEmail('alicerobertson@tidyhome.info', 'plumbingcoloradosprings.com', 'Excellent Plumbing'), true);
});

test('rejects an unrelated third-party domain (web agency, not the contractor)', () => {
  assert.equal(isImplausibleBusinessEmail('eben@eyebytes.com', 'freeflowaustin.com', 'Free Flow Plumbing'), true);
});

test('keeps consumer-provider addresses — a small contractor legitimately uses one', () => {
  assert.equal(isImplausibleBusinessEmail('billsplumbing719@gmail.com', 'billsplumbinganddrainservice.com', "Bill's Plumbing & Drain Service"), false);
  assert.equal(isImplausibleBusinessEmail('threeamigosplumbingco@gmail.com', 'threeamigosplumbingco.com', 'Three Amigos Plumbing'), false);
});

test('keeps an exact or sub-domain match on the business site', () => {
  assert.equal(isImplausibleBusinessEmail('info@smithtotalhome.com', 'smithtotalhome.com', 'Smith Plumbing'), false);
  assert.equal(isImplausibleBusinessEmail('service@leosdrains.com', 'leosdrains.com', "Leo's Sewer & Drain"), false);
});

test('keeps a second domain that matches the BUSINESS NAME rather than the site', () => {
  // Real case: "Adept Plumbing" runs austin-plumber.com but mails from adeptplumbing.com.
  assert.equal(isImplausibleBusinessEmail('christian@adeptplumbing.com', 'austin-plumber.com', 'Adept Plumbing'), false);
});

test('keeps an ISP address whose LOCAL PART names the business', () => {
  // Real case: Ed at Pumps & More, mailing from a hosting-provider domain.
  assert.equal(isImplausibleBusinessEmail('edpumpsnmore@questoffice.net', 'pumpsnmore.net', 'Pumps & More LLC'), false);
});

test('keeps an abbreviated own-domain built from the business acronym', () => {
  // "The Plumber from Down Under" -> pdu. Trade words must NOT be stopwords here,
  // or the acronym collapses and a real lead is dropped.
  assert.equal(isImplausibleBusinessEmail('zadkovicjoe@pduhome.net', 'theplumberfromdownunder.com', 'The Plumber from Down Under'), false);
});

test('isBoilerplateAuthorEmail flags known third-party authors regardless of domain', () => {
  assert.equal(isBoilerplateAuthorEmail('impallari@gmail.com'), true);
  assert.equal(isBoilerplateAuthorEmail('astigma@astigmatic.com'), true);
  assert.equal(isBoilerplateAuthorEmail('info@realplumber.com'), false);
});

test('malformed or empty input is treated as implausible, never accepted', () => {
  assert.equal(isImplausibleBusinessEmail('', 'x.com', 'X'), true);
  assert.equal(isImplausibleBusinessEmail(null, 'x.com', 'X'), true);
  assert.equal(isImplausibleBusinessEmail('not-an-email', 'x.com', 'X'), true);
});

test('missing site and business context does not cause a false rejection', () => {
  // With nothing to compare against, the filter must abstain rather than guess.
  assert.equal(isImplausibleBusinessEmail('info@somecontractor.com', '', ''), false);
});
