'use strict';
/**
 * Regression guard for the field-name bug (2026-07-24): Outscraper's
 * /maps/search-v3 returns the website under `website` and the address under
 * `address`, but Scout's downstream code reads `r.site` / `r.full_address`.
 * The old code requested a `fields` subset naming `site`/`full_address`, which
 * silently dropped the website for EVERY lead — Scout reported "no real site"
 * for 110/110 Austin plumbers that all had websites. normalizeOutscraperRows
 * aliases the real fields onto the names downstream expects.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOutscraperRows } = require('../lib/scout-shared');
const { filterAndFormatHasWebsite } = require('../lib/scout-has-website');

// A row shaped exactly like the real Outscraper response (website, address; no site/full_address).
function outscraperRow(name, website) {
  return { name, website, phone: '+1 512-555-0000', rating: 4.8, reviews: 40, place_id: name, address: `${name} St, Austin, TX` };
}

test('normalizeOutscraperRows — aliases website -> site and address -> full_address', () => {
  const rows = normalizeOutscraperRows([outscraperRow('Austin Plumbing', 'https://austinplumbing.com/')]);
  assert.equal(rows[0].site, 'https://austinplumbing.com/');
  assert.equal(rows[0].full_address, 'Austin Plumbing St, Austin, TX');
});

test('normalizeOutscraperRows — does not clobber an existing site value', () => {
  const rows = normalizeOutscraperRows([{ name: 'X', site: 'https://real.com', website: 'https://other.com' }]);
  assert.equal(rows[0].site, 'https://real.com');
});

test('normalizeOutscraperRows — tolerates junk input', () => {
  assert.doesNotThrow(() => normalizeOutscraperRows(null));
  assert.doesNotThrow(() => normalizeOutscraperRows([null, undefined, 5]));
});

test('end-to-end: normalized rows survive the has-website filter (the bug that hid 110 leads)', () => {
  const raw = normalizeOutscraperRows([
    outscraperRow('Austin Plumbing', 'https://austinplumbing.com/'),
    outscraperRow('Radiant Plumbing', 'https://radiantplumbing.com/austin/'),
  ]);
  const out = filterAndFormatHasWebsite(raw, 'plumber', 'Austin, TX', new Set(), 3, new Set(), 10, 4.0);
  assert.equal(out.disc.noWebsite, 0, 'no website-bearing lead may be discarded as noWebsite');
  assert.equal(out.needsEmail.length, 2, 'both real-site leads must be captured for contact-scraper');
  assert.equal(out.needsEmail[0].site_url.startsWith('http'), true);
});

test('regression: an UN-normalized row (website only) IS wrongly dropped — proves the fix is load-bearing', () => {
  const unfixed = [{ name: 'Austin Plumbing', website: 'https://austinplumbing.com/', phone: '+1 512-555-0000', rating: 4.8, reviews: 40, place_id: 'p' }];
  const out = filterAndFormatHasWebsite(unfixed, 'plumber', 'Austin, TX', new Set(), 3, new Set(), 10, 4.0);
  assert.equal(out.disc.noWebsite, 1, 'without normalization the website is invisible (this is the original bug)');
});
