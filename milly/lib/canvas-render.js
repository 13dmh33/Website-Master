'use strict';

// design hypothesis v1: dark navy + teal
// rationale: brand consistency with Reeve's overall aesthetic — dark, authoritative, premium
// testable: swap DESIGN_CONFIG colors to white (#FFFFFF) bg + teal accent in Phase 2 A/B test
// to change: update DESIGN_CONFIG object below — all render functions reference it
// tracking: note variant name and week started in brand-voice.json visual_hypothesis field

const { Canvas } = require('skia-canvas');
const path = require('path');

const DESIGN_CONFIG = {
  width:       1080,
  height:      1080,
  bg:          '#0B1120',   // dark navy
  headline:    '#FFFFFF',   // white
  body:        '#CBD5E1',   // light gray
  accent:      '#1DA884',   // teal
  muted:       '#64748B',   // slate for slide counters etc.
  fontFamily:  'Arial, sans-serif',
  headlineSize: 52,
  bodySize:     32,
  brandSize:    22,
  padding:      72,
};

// draw the Reeve wordmark in the top-right corner of any canvas context
function renderReeveBrand(ctx, canvasWidth) {
  ctx.font         = `bold ${DESIGN_CONFIG.brandSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('REEVE', canvasWidth - DESIGN_CONFIG.padding, DESIGN_CONFIG.padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// draw a teal top-border accent bar
function renderTopBar(ctx, canvasWidth) {
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(0, 0, canvasWidth, 6);
}

// word-wrap text and return the y position after the last line
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let i = 0; i < words.length; i++) {
    const testLine  = line + (line ? ' ' : '') + words[i];
    const measured  = ctx.measureText(testLine);
    if (measured.width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

// render a single carousel slide as a PNG Buffer
// slideNum and totalSlides are used to draw a progress indicator
async function renderCarouselSlide(headline, body, slideNum, totalSlides) {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  // background
  ctx.fillStyle = DESIGN_CONFIG.bg;
  ctx.fillRect(0, 0, width, height);

  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  // slide counter (e.g. "2 / 6")
  ctx.font      = `${DESIGN_CONFIG.bodySize - 6}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.muted;
  ctx.fillText(`${slideNum} / ${totalSlides}`, padding, padding + 4);

  const contentStartY = padding + 120;

  // headline
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = slideNum === 1 ? DESIGN_CONFIG.accent : DESIGN_CONFIG.headline;
  const headlineEndY = wrapText(ctx, headline, padding, contentStartY, width - padding * 2, DESIGN_CONFIG.headlineSize + 16);

  // body (only if provided and not slide 1 which is hook-only)
  if (body) {
    ctx.font      = `${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.body;
    wrapText(ctx, body, padding, headlineEndY + 32, width - padding * 2, DESIGN_CONFIG.bodySize + 12);
  }

  // bottom accent line
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 48, 4);

  return canvas.toBuffer('png');
}

// render a single-image quote-style post (used for captions and reel hook)
async function renderQuotePost(mainText, attribution) {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  // background
  ctx.fillStyle = DESIGN_CONFIG.bg;
  ctx.fillRect(0, 0, width, height);

  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  // vertical center offset — start text around 35% down
  const startY = Math.floor(height * 0.35);

  // opening quote mark
  ctx.font      = `bold 96px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText('"', padding - 8, startY - 24);

  // main text
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize - 4}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  const endY = wrapText(ctx, mainText, padding, startY, width - padding * 2, DESIGN_CONFIG.headlineSize + 12);

  // attribution
  if (attribution) {
    ctx.font      = `${DESIGN_CONFIG.bodySize - 4}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillText(attribution, padding, endY + 32);
  }

  // bottom accent line
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 48, 4);

  return canvas.toBuffer('png');
}

// fallback renderer — plain white bg, black text, used when main render fails
async function renderFallback(text) {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.font      = `28px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = '#000000';
  wrapText(ctx, text, padding, padding, width - padding * 2, 42);

  ctx.font      = `bold 22px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText('— Reeve', padding, height - padding);

  return canvas.toBuffer('png');
}

module.exports = {
  renderCarouselSlide,
  renderQuotePost,
  renderFallback,
  renderReeveBrand,
  wrapText,
  DESIGN_CONFIG,
};
