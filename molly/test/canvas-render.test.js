'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const render = require('../lib/canvas-render');

test('renderCarouselSlide produces a valid 1080x1080 buffer', async () => {
  const buf = await render.renderCarouselSlide('Slide one headline', 'Some body text', 1, 5, 'education');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  assert.equal(buf.slice(0, 4).toString('hex'), '89504e47');
});

test('renderCaptionPost produces a valid buffer', async () => {
  const buf = await render.renderCaptionPost('Your next customer already searched for you today.', 'Some body copy.', 'results');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderTrevoFoundPost produces a valid buffer', async () => {
  const buf = await render.renderTrevoFoundPost('plumbing demo', 'trevoadvisors.com/demos/plumbing/', [
    'Tap-to-call above the fold', 'Google reviews live', 'Mobile-first',
  ]);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderReelHook (static fallback thumbnail) produces a valid buffer', async () => {
  const buf = await render.renderReelHook('Same contractor. Same trade. One thing changed.', 'reel');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderFallback never throws even with empty text', async () => {
  const buf = await render.renderFallback('', 'education');
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});

// ── reel-frame helpers ─────────────────────────────────────────────────────

test('tokenizeEmphasis marks *asterisk* spans and splits on whitespace', () => {
  const tokens = render.tokenizeEmphasis('Same trade. *One* thing changed.');
  assert.equal(tokens.length, 5);
  assert.equal(tokens.find(t => t.word === 'One').em, true);
  assert.equal(tokens.find(t => t.word === 'Same').em, false);
});

test('tokenizeEmphasis handles no emphasis at all', () => {
  const tokens = render.tokenizeEmphasis('DM us the word demo');
  assert.equal(tokens.length, 5);
  assert.ok(tokens.every(t => t.em === false));
});
