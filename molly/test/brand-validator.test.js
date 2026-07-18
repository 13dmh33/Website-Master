'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { validatePost, validateQueue } = require('../lib/brand-validator');

test('validatePost — a clean post passes', () => {
  const post = {
    caption: 'A customer looks you up before calling. If there is nothing to find, they call the next name on the list.\n\nLearn more — link in bio.',
  };
  const result = validatePost(post);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('validatePost — flags an emoji', () => {
  const result = validatePost({ caption: 'Drop your worst month in the comments 👇' });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.includes('emoji')));
});

test('validatePost — flags "bot"', () => {
  const result = validatePost({ caption: 'Our bot answers the phone for you.' });
  assert.ok(result.failures.some(f => f.includes('bot')));
});

test('validatePost — flags "business days"', () => {
  const result = validatePost({ caption: 'Delivered within 3 business days.' });
  assert.ok(result.failures.some(f => f.includes('business day')));
});

test('validatePost — flags the founder name', () => {
  const result = validatePost({ caption: 'Questions? Reach out to Dave directly.' });
  assert.ok(result.failures.some(f => f.includes('founder')));
});

test('validatePost — flags a stated price', () => {
  const result = validatePost({ caption: 'Sites start at $100 flat.' });
  assert.ok(result.failures.some(f => f.includes('price')));
});

test('validatePost — flags a hard delivery promise but allows the sanctioned phrase', () => {
  const bad = validatePost({ caption: 'Live in 48 hours. DM us the word demo.' });
  assert.ok(bad.failures.some(f => f.includes('delivery-time promise')));

  const ok = validatePost({ caption: 'A new site, in as little as two days, when the fit is right.' });
  assert.equal(ok.failures.some(f => f.includes('delivery-time promise')), false);
});

test('validatePost — flags an unsourced statistic, allows a sourced one', () => {
  const bad = validatePost({ caption: 'Most contractors lose 3-5 jobs a week to competitors.' });
  assert.ok(bad.failures.some(f => f.includes('statistic')));

  const ok = validatePost({ caption: 'Homeowners check reviews before calling 87% of the time (BrightLocal, 2026).' });
  assert.equal(ok.failures.some(f => f.includes('statistic')), false);
});

test('validatePost — flags a city reference', () => {
  const result = validatePost({ caption: 'A Denver plumber found this out the hard way.' });
  assert.ok(result.failures.some(f => f.includes('Denver')));
});

test('validatePost — flags a client-result-shaped claim', () => {
  const result = validatePost({ caption: 'First 30 days: 9 new customers this month. By week 12: 14 new jobs.' });
  assert.ok(result.failures.some(f => f.includes('client result')));
});

test('validatePost — flags ALL CAPS runs', () => {
  const result = validatePost({ caption: 'THIS CHANGES EVERYTHING right now.' });
  assert.ok(result.failures.some(f => f.includes('ALL CAPS')));
});

test('validateQueue — splits passed vs rejected and preserves failure reasons', () => {
  const posts = [
    { caption: 'A clean, compliant post with no violations at all in it.' },
    { caption: 'Live in 48 hours. $100 flat. — Dave' },
  ];
  const { passed, rejected } = validateQueue(posts);
  assert.equal(passed.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].failures.length >= 2);
});

test('validateQueue — every real quarantined post fails validation (proves the gate actually catches the known-bad content)', () => {
  const quarantinePath = path.join(__dirname, '..', 'quarantine', 'evergreen-prespec.json');
  const raw = JSON.parse(fs.readFileSync(quarantinePath, 'utf8'));
  const posts = Array.isArray(raw) ? raw : (raw.posts || raw.evergreen || Object.values(raw).find(Array.isArray));
  assert.ok(Array.isArray(posts) && posts.length > 0, 'quarantine file should contain a posts array');

  const { passed, rejected } = validateQueue(posts);
  assert.equal(passed.length, 0, `expected zero quarantined posts to pass; ${passed.length} did`);
  assert.equal(rejected.length, posts.length);
});
