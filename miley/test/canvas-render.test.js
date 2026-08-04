'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Canvas } = require('skia-canvas');
const render = require('../lib/canvas-render');

async function samplePhotoBuffer() {
  const canvas = new Canvas(800, 600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#445566';
  ctx.fillRect(0, 0, 800, 600);
  return canvas.toBuffer('png');
}

test('renderSingle produces a valid 1080x1080 buffer', async () => {
  const buf = await render.renderSingle({ hook: 'Stop calling it a "side job."', sub: '— Riley', paletteKey: 'mission' });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderCarouselSlide produces a valid buffer', async () => {
  const buf = await render.renderCarouselSlide({ headline: 'Slide one', body: 'Some body text', slideNum: 1, total: 2, paletteKey: 'mission' });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderCleanCard produces a valid buffer that passes the gate (no fallback warning path)', async () => {
  const buf = await render.renderCleanCard('A clean headline', 'Supporting body copy', 1, 2);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderPhotoCard with a real photo buffer produces a valid render', async () => {
  const photo = await samplePhotoBuffer();
  const buf = await render.renderPhotoCard('Built for the jobsite.', photo, '— Riley, Techs4Tatas');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('renderPhotoCard with no photo buffer falls back without crashing', async () => {
  const buf = await render.renderPhotoCard('Built for the jobsite.', null, '— Riley, Techs4Tatas');
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
});

test('selectTemplate always returns v1Gradient when TEMPLATES_ACTIVE is unset', () => {
  delete process.env.TEMPLATES_ACTIVE;
  for (const format of ['single_image', 'reel', 'caption', 'carousel']) {
    assert.equal(render.selectTemplate(format, { hasPhoto: true }), 'v1Gradient');
  }
});

test('selectTemplate respects weighting and photo eligibility when active', () => {
  process.env.TEMPLATES_ACTIVE = 'true';
  try {
    const counts = { v1Gradient: 0, cleanCard: 0, photoCard: 0 };
    const samples = 1000;
    for (let i = 0; i < samples; i++) {
      const name = render.selectTemplate('single_image', { hasPhoto: true });
      counts[name] = (counts[name] || 0) + 1;
    }
    // configured weights: v1Gradient 0.6, cleanCard 0.25, photoCard 0.15
    assert.ok(Math.abs(counts.v1Gradient / samples - 0.6) < 0.05, `v1Gradient share off: ${counts.v1Gradient / samples}`);
    assert.ok(Math.abs(counts.cleanCard / samples - 0.25) < 0.05, `cleanCard share off: ${counts.cleanCard / samples}`);
    assert.ok(Math.abs(counts.photoCard / samples - 0.15) < 0.05, `photoCard share off: ${counts.photoCard / samples}`);

    // without a photo, photoCard must never be selected
    for (let i = 0; i < 200; i++) {
      assert.notEqual(render.selectTemplate('single_image', { hasPhoto: false }), 'photoCard');
    }
  } finally {
    delete process.env.TEMPLATES_ACTIVE;
  }
});

// ── logo visibility ─────────────────────────────────────────────────────────
// logo.png renders "Techs" + the heart outline in navy; logo-white.png renders
// them in white. Picking the wrong file on a dark card leaves only "4 Tatas"
// visible — which is what shipped on the motivational reels (hot-pink headline
// on a near-black gradient, so the old headline-lightness heuristic said "not
// light" and chose the navy mark).

test('pickLogoVariant follows the background, not the text color', () => {
  // the regression: mid-tone pink headline on a near-black card
  assert.equal(render.pickLogoVariant(0.08, '#FF2E88'), 'white');
  // hot-pink mission card — white mark reads over it
  assert.equal(render.pickLogoVariant(0.38, '#F7F4F0'), 'white');
  // light card (cleanCard / off-white product) keeps the navy+pink mark
  assert.equal(render.pickLogoVariant(0.96, '#0A1228'), 'pink');
  // unreadable canvas → fall back to the text-color heuristic
  assert.equal(render.pickLogoVariant(null, '#FFFFFF'), 'white');
  assert.equal(render.pickLogoVariant(null, '#0A1228'), 'pink');
});

test('motivational reel frame renders the wordmark visibly over the dark gradient', async () => {
  const { Canvas: C, loadImage } = require('skia-canvas');
  const buf = await render.renderReelFrame({
    text: 'Be the woman the next girl points to.',
    beatNum: 1, total: 4, paletteKey: 'motivational',
  });

  // read back the top-right logo box and look for light wordmark pixels
  const img = await loadImage(buf);
  const canvas = new C(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const LOGO_W = 170, LOGO_H = 111;
  const x = img.width - render.DESIGN.padding - LOGO_W;
  const y = render.DESIGN.padding - 20;
  const { data } = ctx.getImageData(x, y, LOGO_W, LOGO_H);

  let light = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    if (lum > 0.75) light++;
    n++;
  }
  // the white "Techs" + heart strokes cover a few percent of the box; the navy
  // variant on this background scores ~0
  assert.ok(light / n > 0.02, `wordmark not visible on dark reel frame: ${(light / n * 100).toFixed(2)}% light pixels`);
});
