'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Canvas } = require('skia-canvas');
const { validateRender } = require('../lib/render-validate');

const W = 1080, H = 1080;
const BRAND = ['#FF2E88', '#1A1A1D'];

async function blankCanvasBuffer(bg = '#1A1A1D', w = W, h = H) {
  const canvas = new Canvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  return canvas.toBuffer('png');
}

test('passing buffer: brand color + wordmark + dimensions all pass', async () => {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1A1A1D';
  ctx.fillRect(0, 0, W, H);
  // paint a brand-pink block covering >5% of the canvas
  ctx.fillStyle = '#FF2E88';
  ctx.fillRect(0, 0, W, 200);
  // wordmark region (top-right) gets a visibly different color so it's "non-blank"
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(W - 360, 0, 360, 60);
  const buffer = await canvas.toBuffer('png');

  const result = await validateRender(buffer, 'test', {
    expectedWidth: W,
    expectedHeight: H,
    brandColors: BRAND,
    backgroundColor: '#1A1A1D',
    allowedEdgeColors: ['#FF2E88', '#FFFFFF'],
    wordmarkRegion: { x: W - 360, y: 0, w: 360, h: 60 },
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('fails when no brand color is present', async () => {
  const buffer = await blankCanvasBuffer('#00FF00'); // pure green, nowhere near brand palette
  const result = await validateRender(buffer, 'test', {
    brandColors: BRAND,
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('brand color not detected'));
});

test('fails when the wordmark region is blank', async () => {
  const buffer = await blankCanvasBuffer('#1A1A1D'); // uniform — wordmark region never painted
  const result = await validateRender(buffer, 'test', {
    backgroundColor: '#1A1A1D',
    wordmarkRegion: { x: W - 360, y: 0, w: 360, h: 60 },
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('wordmark region blank'));
});

test('fails on text overflow (ink in the edge bleed zone)', async () => {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1A1A1D';
  ctx.fillRect(0, 0, W, H);
  // paint a sharply different color right at the canvas edge
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 10, 10);
  const buffer = await canvas.toBuffer('png');

  const result = await validateRender(buffer, 'test', {
    backgroundColor: '#1A1A1D',
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('text overflow detected'));
});

test('fails on low contrast text region', async () => {
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#777777';
  ctx.fillRect(0, 0, W, H);
  const buffer = await canvas.toBuffer('png');

  const result = await validateRender(buffer, 'test', {
    textRegions: [{ name: 'headline', x: 0, y: 0, w: 100, h: 100, fg: '#7A7A7A', bg: '#777777', large: false }],
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.includes('contrast below threshold')));
});

test('fails on incorrect dimensions', async () => {
  const buffer = await blankCanvasBuffer('#1A1A1D', 500, 500);
  const result = await validateRender(buffer, 'test', { expectedWidth: W, expectedHeight: H });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(f => f.startsWith('dimensions incorrect')));
});

test('SKIP_VISUAL_GATE=true bypasses every check', async () => {
  process.env.SKIP_VISUAL_GATE = 'true';
  try {
    const buffer = await blankCanvasBuffer('#00FF00', 1, 1);
    const result = await validateRender(buffer, 'test', { expectedWidth: W, expectedHeight: H, brandColors: BRAND });
    assert.equal(result.pass, true);
  } finally {
    delete process.env.SKIP_VISUAL_GATE;
  }
});
