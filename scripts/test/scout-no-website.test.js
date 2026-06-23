const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { filterAndFormatNoWebsite } = require('../lib/scout-no-website');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scout-raw-results.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scout-no-website.golden.json'), 'utf8'));

test('no-website mode regression — output matches golden fixture exactly', () => {
  const { leads } = filterAndFormatNoWebsite(raw, 'plumber', 'Denver, CO', new Set(), 3);
  const stable = leads.map(({ scraped_at, ...rest }) => rest);
  assert.deepEqual(stable, golden);
});

test('no-website mode — every lead has scraped_at as an ISO timestamp', () => {
  const { leads } = filterAndFormatNoWebsite(raw, 'plumber', 'Denver, CO', new Set(), 3);
  for (const l of leads) {
    assert.ok(!Number.isNaN(Date.parse(l.scraped_at)));
  }
});

test('no-website mode — dedup by place_id skips known leads', () => {
  const known = new Set(['p1']);
  const { leads, disc } = filterAndFormatNoWebsite(raw, 'plumber', 'Denver, CO', known, 3);
  assert.ok(!leads.find(l => l.place_id === 'p1'));
  assert.equal(disc.duplicate, 1);
});

test('no-website mode — min-score filters out low gap_score leads', () => {
  const { leads } = filterAndFormatNoWebsite(raw, 'plumber', 'Denver, CO', new Set(), 999);
  assert.deepEqual(leads, []);
});
