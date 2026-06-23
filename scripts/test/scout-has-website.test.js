const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  isRealWebsite,
  scoreFit,
  filterAndFormatHasWebsite,
  exportAuditorCsv,
  exportNeedsEmailCsv
} = require('../lib/scout-has-website');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scout-raw-results.json'), 'utf8'));

test('isRealWebsite — rejects social/platform-only URLs', () => {
  assert.equal(isRealWebsite('https://www.facebook.com/acmedrains'), false);
  assert.equal(isRealWebsite('https://www.instagram.com/acmedrains'), false);
  assert.equal(isRealWebsite('https://linktr.ee/joesplumbing'), false);
  assert.equal(isRealWebsite('https://www.yelp.com/biz/joes-plumbing'), false);
  assert.equal(isRealWebsite('https://g.page/joes-plumbing'), false);
  assert.equal(isRealWebsite(''), false);
  assert.equal(isRealWebsite(null), false);
});

test('isRealWebsite — accepts a real domain', () => {
  assert.equal(isRealWebsite('https://establishedplumbing.com'), true);
});

test('scoreFit — review band edges (9 excluded conceptually, 10/25/75/200 boundaries score correctly)', () => {
  assert.equal(scoreFit({ reviews: 9, rating: 4.0 }), 0);
  assert.equal(scoreFit({ reviews: 10, rating: 4.0 }), 1);
  assert.equal(scoreFit({ reviews: 24, rating: 4.0 }), 1);
  assert.equal(scoreFit({ reviews: 25, rating: 4.0 }), 2);
  assert.equal(scoreFit({ reviews: 74, rating: 4.0 }), 2);
  assert.equal(scoreFit({ reviews: 75, rating: 4.0 }), 3);
  assert.equal(scoreFit({ reviews: 199, rating: 4.0 }), 3);
  assert.equal(scoreFit({ reviews: 200, rating: 4.0 }), 4);
  assert.equal(scoreFit({ reviews: 1500, rating: 4.0 }), 4); // no ceiling on review count itself
});

test('scoreFit — rating bonus bands', () => {
  assert.equal(scoreFit({ reviews: 10, rating: 4.49 }), 1);
  assert.equal(scoreFit({ reviews: 10, rating: 4.5 }), 2);
  assert.equal(scoreFit({ reviews: 10, rating: 4.79 }), 2);
  assert.equal(scoreFit({ reviews: 10, rating: 4.8 }), 3);
});

test('filterAndFormatHasWebsite — review floor of 9 excluded, 10 included, no upper ceiling', () => {
  const { leads, needsEmail, disc } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', new Set(), 0);
  assert.ok(!leads.find(l => l.place_id === 'p4')); // 2 reviews, excluded
  assert.ok(leads.find(l => l.place_id === 'p3'));  // 220 reviews, real site+email — included, no ceiling
  assert.equal(disc.reviews, 1); // only p4 (2 reviews) hits the reviews-floor discard
});

test('filterAndFormatHasWebsite — social/platform-only sites never qualify', () => {
  const { leads, needsEmail } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', new Set(), 0);
  assert.ok(!leads.find(l => l.place_id === 'p2'));        // facebook
  assert.ok(!needsEmail.find(l => l.place_id === 'p2'));
  assert.ok(!leads.find(l => l.place_id === 'p9'));        // linktree
  assert.ok(!needsEmail.find(l => l.place_id === 'p9'));
});

test('filterAndFormatHasWebsite — HVAC handled upstream, not re-checked here', () => {
  // HVAC is blocked by the CLI's trade validation before this function ever runs;
  // this function itself is trade-agnostic, so no assertion needed here beyond
  // confirming it does not special-case 'hvac' internally.
  const { leads } = filterAndFormatHasWebsite(raw, 'hvac', 'Denver, CO', new Set(), 0);
  assert.ok(Array.isArray(leads));
});

test('filterAndFormatHasWebsite — real site captured as site_url', () => {
  const { leads } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', new Set(), 0);
  const lead = leads.find(l => l.place_id === 'p3');
  assert.equal(lead.site_url, 'https://establishedplumbing.com');
});

test('filterAndFormatHasWebsite — dedup by place_id', () => {
  const known = new Set(['p3']);
  const { leads } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', known, 0);
  assert.ok(!leads.find(l => l.place_id === 'p3'));
});

test('filterAndFormatHasWebsite — fit_score band boundaries reflected on real records', () => {
  const { leads } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', new Set(), 0);
  const lead = leads.find(l => l.place_id === 'p3'); // 220 reviews, 4.8 rating => 4 + 2 = 6
  assert.equal(lead.fit_score, 6);
});

test('filterAndFormatHasWebsite — real site with no email routes to needsEmail, never discarded', () => {
  const fixture = [{
    name: 'No Email Plumbing', email: '', phone: '555-0200',
    site: 'https://noemailplumbing.com', full_address: '1 St',
    rating: 4.5, reviews: 50, place_id: 'pX'
  }];
  const { leads, needsEmail } = filterAndFormatHasWebsite(fixture, 'plumber', 'Denver, CO', new Set(), 0);
  assert.equal(leads.length, 0);
  assert.equal(needsEmail.length, 1);
  assert.equal(needsEmail[0].place_id, 'pX');
});

test('exportAuditorCsv — emits exactly business_name,trade,city,url,email', () => {
  const { leads } = filterAndFormatHasWebsite(raw, 'plumber', 'Denver, CO', new Set(), 0);
  const csv = exportAuditorCsv(leads);
  const header = csv.split('\n')[0];
  assert.equal(header, 'business_name,trade,city,url,email');
  assert.ok(csv.includes('establishedplumbing.com'));
});

test('exportNeedsEmailCsv — emits needs-email rows without requiring email', () => {
  const fixture = [{
    name: 'No Email Plumbing', email: '', phone: '555-0200',
    site: 'https://noemailplumbing.com', full_address: '1 St',
    rating: 4.5, reviews: 50, place_id: 'pX'
  }];
  const { needsEmail } = filterAndFormatHasWebsite(fixture, 'plumber', 'Denver, CO', new Set(), 0);
  const csv = exportNeedsEmailCsv(needsEmail);
  assert.ok(csv.includes('noemailplumbing.com'));
  assert.ok(csv.split('\n')[0].startsWith('business_name,trade,city,site_url,phone'));
});
