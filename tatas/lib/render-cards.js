'use strict';

// render-cards.js — 1080x1080 carousel-slide renderer for Tech 4 Tatas.
// Adapted from Miley's skia-canvas approach, simplified to one carousel
// system: cover slide → body slides → closing (CTA) slide.
//
// Fonts: drops in Bebas Neue (headlines) + Inter (body) from assets/fonts/
// when present; falls back to skia-canvas defaults otherwise.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Canvas, FontLibrary } = require('skia-canvas');
const path = require('path');
const fs   = require('fs');

const SIZE   = 1080;
const HANDLE = process.env.TATAS_IG_HANDLE || '@tech4tatas';

const PALETTE = {
  charcoal: '#1A1A1D',
  charcoal2: '#2B2B31',
  pink:     '#FF2E88',
  pinkSoft: '#FFB3D1',
  cream:    '#F7F4F0',
};

// register brand fonts if the .ttf files are present
let HEADLINE_FONT = 'sans-serif';
let BODY_FONT     = 'sans-serif';
(function registerFonts() {
  const fontDir = path.join(__dirname, '..', 'assets', 'fonts');
  const bebas = path.join(fontDir, 'BebasNeue-Regular.ttf');
  const inter = path.join(fontDir, 'Inter-Variable.ttf');
  try {
    if (fs.existsSync(bebas)) { FontLibrary.use('Bebas Neue', [bebas]); HEADLINE_FONT = 'Bebas Neue'; }
    if (fs.existsSync(inter)) { FontLibrary.use('Inter', [inter]); BODY_FONT = 'Inter'; }
  } catch (err) {
    console.warn(`[render-cards] font registration failed (${err.message}) — using defaults.`);
  }
})();

// greedy word-wrap against real text metrics
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawGradient(ctx, from, to) {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function drawFooter(ctx, color) {
  ctx.fillStyle = color;
  ctx.font = `600 34px ${BODY_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(HANDLE, SIZE / 2, SIZE - 70);
}

function drawCenteredBlock(ctx, lines, { font, color, lineHeight, startY }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  let y = startY;
  for (const line of lines) {
    ctx.fillText(line, SIZE / 2, y);
    y += lineHeight;
  }
  return y;
}

// slide 1 — hook/title
async function renderCover(text) {
  const canvas = new Canvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  drawGradient(ctx, PALETTE.charcoal, '#4A1030');

  ctx.font = `96px ${HEADLINE_FONT}`;
  const lines = wrapText(ctx, text.toUpperCase(), SIZE - 200);
  const blockH = lines.length * 108;
  drawCenteredBlock(ctx, lines, {
    font: `96px ${HEADLINE_FONT}`, color: PALETTE.cream,
    lineHeight: 108, startY: (SIZE - blockH) / 2 + 86,
  });

  // pink accent rule under the title
  ctx.fillStyle = PALETTE.pink;
  ctx.fillRect(SIZE / 2 - 90, (SIZE + blockH) / 2 + 40, 180, 10);

  ctx.fillStyle = PALETTE.pinkSoft;
  ctx.font = `500 36px ${BODY_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('swipe →', SIZE / 2, (SIZE + blockH) / 2 + 120);

  drawFooter(ctx, PALETTE.pinkSoft);
  return canvas.toBuffer('png');
}

// middle slides — one line of educational text
async function renderBody(text, index, total) {
  const canvas = new Canvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  drawGradient(ctx, PALETTE.charcoal, PALETTE.charcoal2);

  // slide counter chip
  ctx.fillStyle = PALETTE.pink;
  ctx.font = `54px ${HEADLINE_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${index}/${total}`, SIZE / 2, 130);

  ctx.font = `600 56px ${BODY_FONT}`;
  const lines = wrapText(ctx, text, SIZE - 220);
  const blockH = lines.length * 78;
  drawCenteredBlock(ctx, lines, {
    font: `600 56px ${BODY_FONT}`, color: PALETTE.cream,
    lineHeight: 78, startY: (SIZE - blockH) / 2 + 56,
  });

  drawFooter(ctx, PALETTE.pinkSoft);
  return canvas.toBuffer('png');
}

// last slide — closing / point-to-a-professional
async function renderClosing(text, index, total) {
  const canvas = new Canvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  drawGradient(ctx, PALETTE.pink, '#C21E68');

  ctx.fillStyle = PALETTE.cream;
  ctx.font = `54px ${HEADLINE_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${index}/${total}`, SIZE / 2, 130);

  ctx.font = `600 58px ${BODY_FONT}`;
  const lines = wrapText(ctx, text, SIZE - 220);
  const blockH = lines.length * 80;
  drawCenteredBlock(ctx, lines, {
    font: `600 58px ${BODY_FONT}`, color: PALETTE.cream,
    lineHeight: 80, startY: (SIZE - blockH) / 2 + 58,
  });

  drawFooter(ctx, PALETTE.cream);
  return canvas.toBuffer('png');
}

// render a full carousel → array of PNG buffers, one per slide
async function renderCarousel(slides) {
  const total = slides.length;
  const buffers = [];
  for (let i = 0; i < total; i++) {
    if (i === 0)               buffers.push(await renderCover(slides[i]));
    else if (i === total - 1)  buffers.push(await renderClosing(slides[i], i + 1, total));
    else                       buffers.push(await renderBody(slides[i], i + 1, total));
  }
  return buffers;
}

module.exports = { renderCarousel, PALETTE };
