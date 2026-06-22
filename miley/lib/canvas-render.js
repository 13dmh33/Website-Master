'use strict';

// canvas-render.js — 1080x1080 card renderer for Techs4Tatas (Miley).
//
// Driven by templates/visual-config.json `palettes_by_type`. Unlike the Reeve
// renderer (all-dark), Techs4Tatas palettes can be LIGHT (off-white product,
// hot-pink mission, soft-pink awareness), so every card pulls its own
// bg / headline / body / accent / gradient colors from the palette.
//
// Background priority per the visual-config image_sources order:
//   1. product photo (assets/products/{key}.png) for product posts, + dark overlay
//   2. palette gradient (always available, no network)
//
// Fonts: visual-config asks for Bebas Neue + Inter. Those aren't installed
// server-side, so we render with the skia-canvas default unless you drop the
// .ttf files into assets/fonts/ (any Bebas/Anton/Inter/Work Sans file is picked
// up automatically). The auto-renderer is a fallback — hero graphics are built
// in Canva.

const { Canvas, loadImage } = require('skia-canvas');
const path  = require('path');
const fs    = require('fs');
const store = require('./store');

const DESIGN = {
  width:        1080,
  height:       1080,
  overlay:      'rgba(8, 15, 30, 0.62)', // over product/lifestyle photos
  headlineSize: 64,
  bodySize:     34,
  brandSize:    22,
  padding:      80,
  brandWord:    'TECHS4TATAS',
  fallbackBg:   '#1A1A1D',
};

// ── fonts (best-effort drop-in) ─────────────────────────────────────────────
let HEADLINE_FONT = 'DejaVu Sans';
let BODY_FONT     = 'DejaVu Sans';

(function registerFonts() {
  try {
    const { FontLibrary } = require('skia-canvas');
    const dir = path.join(__dirname, '..', 'assets', 'fonts');
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => /\.(ttf|otf)$/i.test(f));
    for (const f of files) { try { FontLibrary.use(path.join(dir, f)); } catch { /* ignore */ } }
    if (files.some(f => /bebas/i.test(f)))      HEADLINE_FONT = 'Bebas Neue';
    else if (files.some(f => /anton/i.test(f))) HEADLINE_FONT = 'Anton';
    if (files.some(f => /inter/i.test(f)))      BODY_FONT = 'Inter';
    else if (files.some(f => /work/i.test(f)))  BODY_FONT = 'Work Sans';
  } catch { /* skia-canvas default fonts */ }
})();

// ── palette lookup ───────────────────────────────────────────────────────────
function getPalette(paletteKey) {
  const cfg = store.getVisualConfig() || {};
  const palettes = cfg.palettes_by_type || {};
  return palettes[paletteKey] || palettes.mission || {
    bg: DESIGN.fallbackBg, headline: '#FFFFFF', body: '#E2E8F0',
    accent: '#FF2E88', gradient: [DESIGN.fallbackBg, '#2B2B30'],
  };
}

// resolve a product image path if it exists
function productImagePath(productKey) {
  if (!productKey) return null;
  const p = path.join(store.paths.assets, 'products', `${productKey}.png`);
  return fs.existsSync(p) ? p : null;
}

// ── drawing helpers ──────────────────────────────────────────────────────────
function drawGradient(ctx, width, height, palette) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  const stops = palette.gradient && palette.gradient.length >= 2
    ? palette.gradient
    : [palette.bg || DESIGN.fallbackBg, palette.bg || DESIGN.fallbackBg];
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(1, stops[stops.length - 1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // subtle bottom grounding so text reads on busy gradients
  const vig = ctx.createLinearGradient(0, height * 0.6, 0, height);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
}

// returns { headlineColor, bodyColor } actually used (photo bg forces light text)
async function drawBackground(ctx, width, height, palette, productKey) {
  const imgPath = productImagePath(productKey);
  if (imgPath) {
    try {
      const photo = await loadImage(imgPath);
      const scale = Math.max(width / photo.width, height / photo.height);
      const dw = photo.width * scale, dh = photo.height * scale;
      ctx.drawImage(photo, (width - dw) / 2, (height - dh) / 2, dw, dh);
      ctx.fillStyle = DESIGN.overlay;
      ctx.fillRect(0, 0, width, height);
      const grad = ctx.createLinearGradient(0, height * 0.6, 0, height);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(8,15,30,0.78)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      return { headlineColor: '#FFFFFF', bodyColor: '#F7F4F0' };
    } catch { /* fall through to gradient */ }
  }
  drawGradient(ctx, width, height, palette);
  return { headlineColor: palette.headline || '#FFFFFF', bodyColor: palette.body || '#E2E8F0' };
}

function renderTopBar(ctx, width, palette) {
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(0, 0, width, 6);
}

function renderBrand(ctx, width, palette, color) {
  ctx.font         = `bold ${DESIGN.brandSize}px ${HEADLINE_FONT}`;
  ctx.fillStyle    = color || palette.accent || '#FF2E88';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(DESIGN.brandWord, width - DESIGN.padding, DESIGN.padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = (text || '').split(' ');
  let line = '', currentY = y;
  for (let i = 0; i < words.length; i++) {
    const test = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(test).width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, currentY); currentY += lineHeight; }
  return currentY;
}

// ── public renderers ─────────────────────────────────────────────────────────

// single image / quote-style card (hook is the hero line)
async function renderSingle({ hook, sub, paletteKey, productKey }) {
  const { width, height, padding } = DESIGN;
  const palette = getPalette(paletteKey);
  const canvas  = new Canvas(width, height);
  const ctx     = canvas.getContext('2d');

  const { headlineColor, bodyColor } = await drawBackground(ctx, width, height, palette, productKey);
  renderTopBar(ctx, width, palette);
  renderBrand(ctx, width, palette, headlineColor);

  // big accent quote mark
  ctx.font = `bold 120px ${HEADLINE_FONT}`;
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.globalAlpha = 0.8;
  ctx.fillText('"', padding - 8, height * 0.34);
  ctx.globalAlpha = 1;

  ctx.font = `bold ${DESIGN.headlineSize}px ${HEADLINE_FONT}`;
  ctx.fillStyle = headlineColor;
  const endY = wrapText(ctx, hook, padding, height * 0.4, width - padding * 2, DESIGN.headlineSize + 12);

  if (sub) {
    ctx.font = `${DESIGN.bodySize - 4}px ${BODY_FONT}`;
    ctx.fillStyle = palette.accent || bodyColor;
    ctx.fillText(sub, padding, endY + 30);
  }

  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(padding, height - padding, 56, 5);
  return canvas.toBuffer('png');
}

// one carousel slide
async function renderCarouselSlide({ headline, body, slideNum, total, paletteKey, productKey }) {
  const { width, height, padding } = DESIGN;
  const palette = getPalette(paletteKey);
  const canvas  = new Canvas(width, height);
  const ctx     = canvas.getContext('2d');

  const { headlineColor, bodyColor } = await drawBackground(ctx, width, height, palette, slideNum === 1 ? productKey : null);
  renderTopBar(ctx, width, palette);
  renderBrand(ctx, width, palette, headlineColor);

  // slide counter
  ctx.font = `${DESIGN.bodySize - 10}px ${BODY_FONT}`;
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillText(`${slideNum} / ${total}`, padding, padding + 8);

  const contentY = padding + 150;
  if (slideNum > 1) {
    ctx.fillStyle = palette.accent || '#FF2E88';
    ctx.fillRect(padding, contentY - 24, 44, 4);
  }

  ctx.font = `bold ${DESIGN.headlineSize}px ${HEADLINE_FONT}`;
  ctx.fillStyle = slideNum === 1 ? (palette.accent || headlineColor) : headlineColor;
  const afterHeadline = wrapText(ctx, headline, padding, contentY, width - padding * 2, DESIGN.headlineSize + 14);

  if (body) {
    ctx.font = `${DESIGN.bodySize}px ${BODY_FONT}`;
    ctx.fillStyle = bodyColor;
    wrapText(ctx, body, padding, afterHeadline + 30, width - padding * 2, DESIGN.bodySize + 10);
  }

  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(padding, height - padding, 56, 5);
  return canvas.toBuffer('png');
}

// last-resort plain render
async function renderFallback(text, paletteKey) {
  const { width, height, padding } = DESIGN;
  const palette = getPalette(paletteKey);
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  drawGradient(ctx, width, height, palette);
  renderTopBar(ctx, width, palette);
  renderBrand(ctx, width, palette, palette.headline);
  ctx.font = `bold ${DESIGN.bodySize}px ${BODY_FONT}`;
  ctx.fillStyle = palette.headline || '#FFFFFF';
  wrapText(ctx, text, padding, padding + 90, width - padding * 2, 46);
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(padding, height - padding, 56, 5);
  return canvas.toBuffer('png');
}

module.exports = {
  renderSingle,
  renderCarouselSlide,
  renderFallback,
  getPalette,
  productImagePath,
  wrapText,
  DESIGN,
};
