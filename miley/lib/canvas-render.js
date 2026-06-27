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
const { validateRender } = require('./render-validate');

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
  colorCardLight: '#F8F9FA', // renderCleanCard background
  // selectTemplate (#11) — eligible templates per Generator format, and the
  // weighted-random split used when TEMPLATES_ACTIVE=true. v1Gradient stays
  // dominant so existing brand look doesn't get diluted by the new layouts.
  templateWeights: {
    single_image: { v1Gradient: 0.6, cleanCard: 0.25, photoCard: 0.15 },
    reel:         { v1Gradient: 1.0 },
    caption:      { v1Gradient: 1.0 },
    carousel:     { v1Gradient: 0.6, cleanCard: 0.4 },
  },
};

// wordmark bounding box for the visual gate — matches renderBrand()'s
// right-aligned placement (DESIGN.brandSize text ending at width - padding).
function wordmarkRegion(width) {
  return { x: width - DESIGN.padding - 280, y: DESIGN.padding - 6, w: 280, h: DESIGN.brandSize + 14 };
}

function brandColorList() {
  const cfg = store.getVisualConfig() || {};
  return Object.values(cfg.brand_colors || {});
}

// run the buffer through the visual quality gate; on failure, log and swap in
// the plain fallback render instead of ever queueing/writing a bad card.
async function gateOrFallback(buffer, templateName, gateOpts, fallbackText, paletteKey) {
  const result = await validateRender(buffer, templateName, {
    expectedWidth:  DESIGN.width,
    expectedHeight: DESIGN.height,
    brandColors:    brandColorList(),
    wordmarkRegion: wordmarkRegion(DESIGN.width),
    ...gateOpts,
  });
  if (result.pass) return buffer;
  console.warn(`[canvas-render] "${templateName}" failed the visual gate: ${result.failures.join('; ')} — using plain fallback.`);
  return renderFallback(fallbackText, paletteKey);
}

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
  const buffer = await canvas.toBuffer('png');
  return gateOrFallback(buffer, 'v1Gradient/single', {
    backgroundColor: palette.bg,
    allowedEdgeColors: [palette.accent || '#FF2E88', ...(palette.gradient || [])],
    textRegions: [{ name: 'headline', x: padding, y: Math.round(height * 0.4), w: width - padding * 2, h: DESIGN.headlineSize, fg: headlineColor, bg: palette.bg, large: true }],
  }, hook, paletteKey);
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
  const buffer = await canvas.toBuffer('png');
  return gateOrFallback(buffer, 'v1Gradient/carousel', {
    backgroundColor: palette.bg,
    allowedEdgeColors: [palette.accent || '#FF2E88', ...(palette.gradient || [])],
    textRegions: [{ name: 'headline', x: padding, y: contentY, w: width - padding * 2, h: DESIGN.headlineSize, fg: headlineColor, bg: palette.bg, large: true }],
  }, headline, paletteKey);
}

// ── new template: stat card ─────────────────────────────────────────────────
// for trades_stat posts: the verified number is the hero, dead center and huge,
// with a one-line context underneath and the source credited at the bottom.
// statNumber/statContext/statSource come straight from inspiration-sources.json
// data_hooks (lib/researcher.js → generator.js), never from Claude/evergreen
// text — so the figure on the image always matches the verified hook.
async function renderStatCard({ statNumber, statContext, source, paletteKey }) {
  const { width, height, padding } = DESIGN;
  const palette = getPalette(paletteKey);
  const canvas  = new Canvas(width, height);
  const ctx     = canvas.getContext('2d');

  const { headlineColor, bodyColor } = await drawBackground(ctx, width, height, palette, null);
  renderTopBar(ctx, width, palette);
  renderBrand(ctx, width, palette, headlineColor);

  // the number — huge, centered, the whole point of the card
  ctx.textAlign = 'center';
  let numSize = 220;
  ctx.font = `bold ${numSize}px ${HEADLINE_FONT}`;
  while (ctx.measureText(statNumber).width > width - padding * 1.5 && numSize > 100) {
    numSize -= 10;
    ctx.font = `bold ${numSize}px ${HEADLINE_FONT}`;
  }
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillText(statNumber, width / 2, height * 0.52);

  // accent rule under the number
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(width / 2 - 60, height * 0.52 + 30, 120, 5);

  // context line
  ctx.font = `${DESIGN.headlineSize - 26}px ${BODY_FONT}`;
  ctx.fillStyle = headlineColor;
  ctx.textBaseline = 'alphabetic';
  const wrapped = wrapTextCentered(ctx, statContext || '', width / 2, height * 0.52 + 80, width - padding * 2, DESIGN.headlineSize - 14);

  // source credit, bottom
  if (source) {
    ctx.font = `${DESIGN.brandSize}px ${BODY_FONT}`;
    ctx.fillStyle = palette.accent || bodyColor;
    ctx.fillText(`— per ${source.split('(')[0].trim()}`, width / 2, height - padding);
  }
  ctx.textAlign = 'left';

  const buffer = await canvas.toBuffer('png');
  return gateOrFallback(buffer, 'statCard', {
    backgroundColor: palette.bg,
    allowedEdgeColors: [palette.accent || '#FF2E88', ...(palette.gradient || [])],
    textRegions: [{ name: 'stat', x: padding, y: Math.round(height * 0.4), w: width - padding * 2, h: numSize, fg: palette.accent, bg: palette.bg, large: true }],
  }, `${statNumber} ${statContext || ''}`.trim(), paletteKey);
}

// centered word-wrap variant of wrapText
function wrapTextCentered(ctx, text, cx, y, maxWidth, lineHeight) {
  const words = (text || '').split(' ');
  let line = '', currentY = y;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'center';
  for (let i = 0; i < words.length; i++) {
    const test = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(test).width > maxWidth && i > 0) {
      ctx.fillText(line, cx, currentY);
      line = words[i];
      currentY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, cx, currentY); currentY += lineHeight; }
  ctx.textAlign = prevAlign;
  return currentY;
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

// ── new template: clean card ────────────────────────────────────────────────
// high-contrast, print-adjacent layout for text-heavy slots (carousel slides
// or a single card) where the dark gradient bg competes with readability.
async function renderCleanCard(headline, body, slideNum, totalSlides) {
  const { width, height, padding } = DESIGN;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = DESIGN.colorCardLight;
  const headlineColor = '#0A1228'; // navy — matches Trevo-family ink, reads clean on light cards
  const bodyColor = '#374151';
  const accent = '#FF2E88';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 4px teal-adjacent brand accent bar down the left edge
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 4, height);

  renderBrand(ctx, width, { accent: headlineColor }, headlineColor);

  let contentY = padding + 100;
  if (totalSlides && totalSlides > 1) {
    ctx.font = `${DESIGN.bodySize - 10}px ${BODY_FONT}`;
    ctx.fillStyle = accent;
    ctx.fillText(`${slideNum} / ${totalSlides}`, padding, padding + 8);
    contentY = padding + 150;
  }

  ctx.font = `bold ${DESIGN.headlineSize}px ${HEADLINE_FONT}`;
  ctx.fillStyle = headlineColor;
  const afterHeadline = wrapText(ctx, headline, padding, contentY, width - padding * 2, DESIGN.headlineSize + 14);

  if (body) {
    ctx.font = `${DESIGN.bodySize}px ${BODY_FONT}`;
    ctx.fillStyle = bodyColor;
    wrapText(ctx, body, padding, afterHeadline + 30, width - padding * 2, DESIGN.bodySize + 10);
  }

  ctx.fillStyle = accent;
  ctx.fillRect(padding, height - padding, 56, 5);

  const buffer = await canvas.toBuffer('png');
  return gateOrFallback(buffer, 'cleanCard', {
    backgroundColor: bg,
    allowedEdgeColors: [accent],
    textRegions: [{ name: 'headline', x: padding, y: contentY, w: width - padding * 2, h: DESIGN.headlineSize, fg: headlineColor, bg, large: true }],
  }, headline, 'mission');
}

// ── new template: photo card ────────────────────────────────────────────────
// full-bleed photo background with a dark overlay so text always reads. This
// is the Printify-ready slot — once product mockups exist they pass straight
// in as photoBuffer. Until then it accepts any image buffer.
async function renderPhotoCard(headline, photoBuffer, attribution) {
  const { width, height, padding } = DESIGN;

  if (!photoBuffer) {
    console.warn('[canvas-render] renderPhotoCard called with no photoBuffer — falling back to renderCarouselSlide.');
    return renderCarouselSlide({ headline, body: attribution || '', slideNum: 1, total: 1, paletteKey: 'mission' });
  }

  let photo;
  try {
    photo = await loadImage(photoBuffer);
  } catch (err) {
    console.warn(`[canvas-render] renderPhotoCard failed to load photoBuffer (${err.message}) — falling back to renderCarouselSlide.`);
    return renderCarouselSlide({ headline, body: attribution || '', slideNum: 1, total: 1, paletteKey: 'mission' });
  }

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  const scale = Math.max(width / photo.width, height / photo.height);
  const dw = photo.width * scale, dh = photo.height * scale;
  ctx.drawImage(photo, (width - dw) / 2, (height - dh) / 2, dw, dh);

  ctx.fillStyle = 'rgba(10, 18, 40, 0.65)'; // navy at 65% — always-readable overlay
  ctx.fillRect(0, 0, width, height);

  renderBrand(ctx, width, { accent: '#FFFFFF' }, '#FFFFFF');

  ctx.font = `bold ${DESIGN.headlineSize}px ${HEADLINE_FONT}`;
  ctx.fillStyle = '#FFFFFF';
  const afterHeadline = wrapText(ctx, headline, padding, height * 0.4, width - padding * 2, DESIGN.headlineSize + 12);

  if (attribution) {
    ctx.font = `${DESIGN.bodySize - 8}px ${BODY_FONT}`;
    ctx.fillStyle = '#FF2E88';
    ctx.fillText(attribution, padding, height - padding);
  }

  // brand accent band — photo+overlay alone won't carry enough brand color
  // coverage to pass the gate, so anchor it with a deliberate pink band.
  ctx.fillStyle = '#FF2E88';
  ctx.fillRect(0, height - 70, width, 70);

  const buffer = await canvas.toBuffer('png');
  return gateOrFallback(buffer, 'photoCard', {
    backgroundColor: '#0A1228',
    allowedEdgeColors: ['#FF2E88'],
    textRegions: [{ name: 'headline', x: padding, y: Math.round(height * 0.4), w: width - padding * 2, h: DESIGN.headlineSize, fg: '#FFFFFF', bg: '#0A1228', large: true }],
  }, headline, 'mission');
}

// ── template selector (gated behind TEMPLATES_ACTIVE) ───────────────────────
// format: the Generator's post.format value ('single_image' | 'reel' | 'caption' | 'carousel').
// Returns a template name string: 'v1Gradient' | 'cleanCard' | 'photoCard'.
// TEMPLATES_ACTIVE defaults to false/unset, which always returns 'v1Gradient' —
// i.e. zero behavior change until Printify assets exist and this is flipped on.
function selectTemplate(format, context = {}) {
  if (process.env.TEMPLATES_ACTIVE !== 'true') return 'v1Gradient';

  const weights = DESIGN.templateWeights[format] || { v1Gradient: 1 };
  // photoCard only makes sense when there's an actual product/photo to show
  const eligible = Object.entries(weights).filter(([name]) => name !== 'photoCard' || context.hasPhoto);
  const total = eligible.reduce((s, [, w]) => s + w, 0) || 1;

  let roll = Math.random() * total;
  for (const [name, w] of eligible) {
    if (roll < w) return name;
    roll -= w;
  }
  return eligible.length ? eligible[eligible.length - 1][0] : 'v1Gradient';
}

module.exports = {
  renderSingle,
  renderCarouselSlide,
  renderCleanCard,
  renderPhotoCard,
  renderStatCard,
  selectTemplate,
  renderFallback,
  getPalette,
  productImagePath,
  wrapText,
  DESIGN,
};
