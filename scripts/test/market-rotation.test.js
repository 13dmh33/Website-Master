'use strict';
/**
 * Tests for market rotation. The risk this guards against is subtle: if
 * completion detection breaks, the daily pipeline silently re-scouts a market
 * it already exhausted, spends Outscraper budget, and returns nothing new —
 * looking exactly like "the market is dry" rather than "the picker is broken".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  slugifyCity, comboKey, completedCombos, nextTarget, rotationStatus, TRADES,
} = require('../lib/market-rotation');

/** Build a throwaway repo root with leads/ + leads-web/ containing given files. */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-'));
  fs.mkdirSync(path.join(root, 'leads'));
  fs.mkdirSync(path.join(root, 'leads-web'));
  for (const [dir, name] of files) fs.writeFileSync(path.join(root, dir, name), '[]');
  return root;
}

test('slugify matches the shape Scout writes to disk', () => {
  assert.equal(slugifyCity('Colorado Springs, CO'), 'colorado-springs-co');
  assert.equal(slugifyCity('Denver, CO'), 'denver-co');
  assert.equal(comboKey('Grand Junction, CO', 'roofer'), 'grand-junction-co-roofer');
});

test('detects completed combos from real Scout filenames', () => {
  const root = fixture([
    ['leads', 'denver-co-plumber-2026-05-28-run1.json'],
    ['leads-web', 'colorado-springs-co-plumber-2026-07-28-run1.json'],
  ]);
  const done = completedCombos(root);
  assert.ok(done.has('denver-co-plumber'));
  assert.ok(done.has('colorado-springs-co-plumber'));
  assert.ok(!done.has('denver-co-roofer'));
});

test('the needs-email- prefix does not hide a completed combo', () => {
  // Real files carry this prefix; missing it would re-scout a worked market.
  const root = fixture([
    ['leads', 'needs-email-colorado-springs-co-plumber-2026-07-28-run1.json'],
  ]);
  assert.ok(completedCombos(root).has('colorado-springs-co-plumber'));
});

test('a multi-word city slug is not truncated at the first hyphen', () => {
  const root = fixture([
    ['leads-web', 'grand-junction-co-electrician-2026-08-01-run1.json'],
  ]);
  assert.ok(completedCombos(root).has('grand-junction-co-electrician'));
});

test('walks remaining trades in a city before moving to the next city', () => {
  const done = new Set(['denver-co-plumber', 'denver-co-electrician']);
  const next = nextTarget({ cities: ['Denver, CO', 'Boulder, CO'], done });
  assert.deepEqual(next, { city: 'Denver, CO', trade: 'handyman' });
});

test('advances to the next city once a city is fully worked', () => {
  const done = new Set(TRADES.map(t => `denver-co-${t}`));
  const next = nextTarget({ cities: ['Denver, CO', 'Boulder, CO'], done });
  assert.deepEqual(next, { city: 'Boulder, CO', trade: 'plumber' });
});

test('returns null when everything is exhausted — caller must not treat it as a no-op', () => {
  const done = new Set(TRADES.map(t => `denver-co-${t}`));
  assert.equal(nextTarget({ cities: ['Denver, CO'], done }), null);
});

test('hvac is never a rotation trade', () => {
  assert.ok(!TRADES.includes('hvac'), 'HVAC is excluded — conflict of interest');
});

test('status counts every city x trade combination', () => {
  const root = fixture([['leads', 'denver-co-plumber-2026-05-28-run1.json']]);
  const s = rotationStatus({ cities: ['Denver, CO', 'Boulder, CO'], root });
  assert.equal(s.total, 8);      // 2 cities x 4 trades
  assert.equal(s.done, 1);
  assert.equal(s.remaining, 7);
});
