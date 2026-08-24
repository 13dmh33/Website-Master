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
  reelWidth:    1080, // vertical 9:16 reel frame
  reelHeight:   1920,
  headlineSize: 64,
  reelSize:     92, // on-screen reel text — big, phone-legible in motion
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
// top-right placement (logo image when assets/logo*.png exist, else text).
function wordmarkRegion(width) {
  return { x: width - DESIGN.padding - LOGO_W, y: LOGO_Y, w: LOGO_W, h: LOGO_H };
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

// ── readable reel accent ────────────────────────────────────────────────────
// Reel frames highlight the punch word (*word* in the script) in the palette
// accent. On palettes whose gradient IS the accent color — product_feature and
// awareness are both pink-on-pink — that word vanishes mid-scroll, so the
// accent is re-picked from the brand colors per frame.
const ACCENT_CANDIDATES = ['#FFC400', '#1A1A1D', '#F7F4F0'];

function relLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A punch word has to clear TWO things to register in motion: the background it
// sits on, and the base text color of the words around it. Score every brand
// candidate by its weaker of those two contrasts and take the best — that keeps
// the palette accent wherever it already works and only swaps it where it
// doesn't (product_feature's accent IS its gradient; mission's accent is close
// enough to its base text to read as a smudge).
function readableAccent(palette, headlineColor) {
  const stops = palette.gradient && palette.gradient.length >= 2
    ? palette.gradient : [palette.bg, palette.bg];
  const bg = stops[Math.floor(stops.length / 2)] || palette.bg || '#1A1A1D';
  const base = headlineColor || palette.headline || '#FFFFFF';

  const candidates = [palette.accent || '#FF2E88', ...ACCENT_CANDIDATES];
  return candidates
    .map(c => ({ c, score: Math.min(contrastRatio(c, bg), contrastRatio(c, base)) }))
    .sort((a, b) => b.score - a.score)[0].c;
}

// ── product photo compositing ───────────────────────────────────────────────
// The Printify mockups in assets/products/ are flat 1200x1200 studio shots on a
// white sweep, not lifestyle photography. Cover-cropping one to fill the frame
// and washing it out under a 62% overlay reads as a mistake: on a square card
// the product ends up as a muddy ghost behind the headline, and on a 9:16 reel
// frame the crop (scale 1.6) throws the product's edges off-canvas entirely.
//
// So a product photo is composited in two layers instead:
//   1. BACKDROP — the photo cover-cropped and heavily blurred, then covered by
//      the palette gradient at high alpha. Gives the card a product-tinted
//      ground with real texture while the brand color stays dominant.
//   2. HERO — the same photo contain-fit (never cropped) into a box sized and
//      placed per aspect ratio, with a soft contact shadow, so the product is
//      actually recognizable. The box is kept clear of each format's text band.
//
// Text colors keep coming from the palette (the gradient, not the photo, sets
// the effective background), which also keeps the visual gate's contrast check
// honest — the old photo path forced white text but still handed the gate
// `palette.bg`, so light palettes like product_feature always failed and got
// bounced to the plain fallback.

// hero box as fractions of the frame: { w, h, top } — w/h are max extents, the
// photo is contain-fit inside and centered horizontally on `top`.
function heroBox(width, height) {
  const portrait = height > width * 1.2; // 9:16 reel frame
  return portrait
    ? { w: 0.60, h: 0.30, top: 0.62 }  // below the centered reel text band
    : { w: 0.62, h: 0.44, top: 0.50 }; // below the square card's headline
}

function drawProductBackdrop(ctx, width, height, palette, photo) {
  const scale = Math.max(width / photo.width, height / photo.height);
  const dw = photo.width * scale, dh = photo.height * scale;

  ctx.save();
  try { ctx.filter = 'blur(90px)'; } catch { /* older skia-canvas: unblurred */ }
  ctx.drawImage(photo, (width - dw) / 2, (height - dh) / 2, dw, dh);
  ctx.restore();

  // palette gradient over the top so brand color, not the studio white, leads.
  // High alpha on purpose: the blurred photo is there for depth, not shape —
  // any less and the product's silhouette shows through as a smudge.
  ctx.save();
  ctx.globalAlpha = 0.9;
  drawGradient(ctx, width, height, palette);
  ctx.restore();
}

// rounded-rect path (skia-canvas has roundRect, but keep it explicit)
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// The mockups carry a wide white margin around the product. Trim it so the
// product actually fills its tile instead of floating in a field of white.
const SOURCE_INSET = 0.09;

function drawProductHero(ctx, width, height, photo) {
  const box = heroBox(width, height);
  const side = Math.min(width * box.w, height * box.h);
  const x = (width - side) / 2;
  const y = height * box.top + (height * box.h - side) / 2;
  const radius = Math.round(side * 0.06);

  // contact shadow so the tile sits on the card rather than being pasted on
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  try { ctx.filter = 'blur(28px)'; } catch { /* no-op */ }
  roundRectPath(ctx, x, y + side * 0.03, side, side, radius);
  ctx.fill();
  ctx.restore();

  // the product tile: source-inset crop of the mockup, clipped to a rounded square
  const inset = photo.width * SOURCE_INSET;
  ctx.save();
  roundRectPath(ctx, x, y, side, side, radius);
  ctx.clip();
  ctx.drawImage(
    photo,
    inset, inset, photo.width - inset * 2, photo.height - inset * 2,
    x, y, side, side
  );
  ctx.restore();
}

// returns { headlineColor, bodyColor } actually used
async function drawBackground(ctx, width, height, palette, productKey) {
  const imgPath = productImagePath(productKey);
  if (imgPath) {
    try {
      const photo = await loadImage(imgPath);
      drawProductBackdrop(ctx, width, height, palette, photo);
      drawProductHero(ctx, width, height, photo);
      return {
        headlineColor: palette.headline || '#FFFFFF',
        bodyColor:     palette.body || '#E2E8F0',
      };
    } catch { /* fall through to gradient */ }
  }
  drawGradient(ctx, width, height, palette);
  return { headlineColor: palette.headline || '#FFFFFF', bodyColor: palette.body || '#E2E8F0' };
}

function renderTopBar(ctx, width, palette) {
  ctx.fillStyle = palette.accent || '#FF2E88';
  ctx.fillRect(0, 0, width, 6);
}

// brand mark top-right: the real Techs4Tatas logo (assets/logo.png pink,
// assets/logo-white.png for dark backgrounds), sized to LOGO_W. Falls back to
// the text wordmark only if the logo assets are missing.
const LOGO_W = 170;
const LOGO_H = 111; // matches assets/logo*.png aspect (706x462)
const LOGO_Y = DESIGN.padding - 20;
const logoCache = {};

async function loadLogo(variant) {
  if (variant in logoCache) return logoCache[variant];
  const file = path.join(__dirname, '..', 'assets', variant === 'white' ? 'logo-white.png' : 'logo.png');
  try {
    logoCache[variant] = fs.existsSync(file) ? await loadImage(file) : null;
  } catch { logoCache[variant] = null; }
  return logoCache[variant];
}

// pick the white logo when the card's brand color is light (i.e. dark bg)
function isLightColor(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

// mean relative luminance of what's already been drawn in a region — used to
// pick the logo variant from the ACTUAL background rather than from the
// headline color, which is only a proxy for it and gets it wrong on the pink
// palettes (mission / product_feature / awareness).
function sampleLuminance(ctx, x, y, w, h) {
  try {
    const data = ctx.getImageData(Math.max(0, x), Math.max(0, y), Math.max(1, w), Math.max(1, h)).data;
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 7) { // every 7th pixel is plenty
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      n++;
    }
    return n ? sum / n : 0;
  } catch { return 0; }
}

// The two logo files aren't a light/dark pair of the same mark — each is a
// two-tone lockup, and BOTH contain the brand pink:
//   logo.png       navy "Techs" + pink "Tatas"   (for light backgrounds)
//   logo-white.png white "Techs" + pink "Tatas"  (for dark backgrounds)
// So on a pink card no variant reads on its own: the pink half always sinks
// into the background. Pick the better variant by measured background
// luminance, then, when either half is still low-contrast, separate the whole
// mark with a soft shadow instead of leaving it to wash out.
const LOGO_INK = { white: ['#FFFFFF', '#FF2E88'], pink: ['#1A1A1D', '#FF2E88'] };

function luminanceToHex(l) {
  const v = Math.round(Math.max(0, Math.min(1, l)) * 255);
  return '#' + [v, v, v].map(c => c.toString(16).padStart(2, '0')).join('');
}

async function renderBrand(ctx, width, palette, color) {
  const box = wordmarkRegion(width);
  const bgLum = sampleLuminance(ctx, box.x, box.y, box.w, box.h);
  const variant = bgLum < 0.55 ? 'white' : 'pink';
  const logo = await loadLogo(variant);
  if (logo) {
    const h = LOGO_W * (logo.height / logo.width);
    // weakest half of the lockup against the background it actually lands on
    const bgHex = luminanceToHex(bgLum);
    const worst = Math.min(...LOGO_INK[variant].map(ink => contrastRatio(ink, bgHex)));

    ctx.save();
    if (worst < 3.0) {
      ctx.shadowColor   = bgLum < 0.55 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
      ctx.shadowBlur    = 14;
      ctx.shadowOffsetY = 2;
    }
    ctx.drawImage(logo, box.x, LOGO_Y, LOGO_W, h);
    ctx.restore();
    return;
  }
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
  await renderBrand(ctx, width, palette, headlineColor);

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
  await renderBrand(ctx, width, palette, headlineColor);

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

// last-resort plain render
async function renderFallback(text, paletteKey) {
  const { width, height, padding } = DESIGN;
  const palette = getPalette(paletteKey);
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  drawGradient(ctx, width, height, palette);
  renderTopBar(ctx, width, palette);
  await renderBrand(ctx, width, palette, palette.headline);
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

  await renderBrand(ctx, width, { accent: headlineColor }, headlineColor);

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

  await renderBrand(ctx, width, { accent: '#FFFFFF' }, '#FFFFFF');

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

// ── reel frame (vertical 1080x1920) ──────────────────────────────────────────
// one beat of a Reel: big centered ON-SCREEN text over the brand background.
// Frames are composited into an .mp4 by lib/reel.js (which adds the moving film
// grain + vignette grade). To read as a real Reel, not a carousel slide, this:
//   • shows a Stories-style segmented progress bar (never an "N/M" counter)
//   • highlights the punch word (marked *word* in the script) in the accent color
//   • bakes a soft vignette for depth
//   • keeps text inside a safe band clear of Instagram's action rail / caption
// Not run through the square visual gate (9:16).

// tokenize text into words, marking any span wrapped in *asterisks* as emphasized
function tokenizeEmphasis(text) {
  const tokens = [];
  const parts = (text || '').split(/(\*[^*]+\*)/g).filter(Boolean);
  for (const part of parts) {
    const em = /^\*[^*]+\*$/.test(part);
    const clean = em ? part.slice(1, -1) : part;
    for (const w of clean.split(/\s+/).filter(Boolean)) tokens.push({ word: w, em });
  }
  return tokens;
}

// wrap emphasis tokens into lines that fit maxWidth at the current ctx.font
function wrapTokens(ctx, tokens, maxWidth) {
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [], lineW = 0;
  for (const tk of tokens) {
    const w = ctx.measureText(tk.word).width;
    const needed = line.length ? space + w : w;
    if (lineW + needed > maxWidth && line.length) { lines.push(line); line = []; lineW = 0; }
    lineW += line.length ? space + w : w;
    line.push(tk);
  }
  if (line.length) lines.push(line);
  return lines;
}

// draw one wrapped line centered on cx, coloring emphasized tokens with accent
function drawTokenLine(ctx, lineTokens, cx, y, baseColor, accentColor) {
  const space  = ctx.measureText(' ').width;
  const widths = lineTokens.map(tk => ctx.measureText(tk.word).width);
  const total  = widths.reduce((a, b) => a + b, 0) + space * (lineTokens.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = 'left';
  lineTokens.forEach((tk, i) => {
    ctx.fillStyle = tk.em ? accentColor : baseColor;
    ctx.fillText(tk.word, x, y);
    x += widths[i] + space;
  });
}

// soft radial vignette for filmic depth (kept subtle so text stays legible)
function drawVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.24, w / 2, h / 2, h * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Stories-style segmented progress bar across the top; segments up to the
// current beat are filled with the accent color.
function drawProgressBar(ctx, w, beatNum, total, accent, padding) {
  const y = 30, h = 7, gap = 8, side = padding;
  const segW = (w - side * 2 - gap * Math.max(0, total - 1)) / Math.max(1, total);
  for (let i = 0; i < total; i++) {
    ctx.fillStyle = i < beatNum ? accent : 'rgba(255,255,255,0.30)';
    ctx.fillRect(side + i * (segW + gap), y, segW, h);
  }
}

async function renderReelFrame({ text, beatNum, total, paletteKey, productKey, isCta }) {
  const width = DESIGN.reelWidth, height = DESIGN.reelHeight, padding = DESIGN.padding;
  const palette = getPalette(paletteKey);
  const canvas  = new Canvas(width, height);
  const ctx     = canvas.getContext('2d');

  const { headlineColor } = await drawBackground(ctx, width, height, palette, productKey);
  const accent = readableAccent(palette, headlineColor);
  drawVignette(ctx, width, height);
  await renderBrand(ctx, width, palette, headlineColor);
  if (total > 1) drawProgressBar(ctx, width, beatNum, total, accent, padding);

  // auto-fit the on-screen text: shrink until it fits ~5 lines in the safe band.
  // Right margin is a touch wider to keep text clear of IG's action rail.
  const maxTextWidth = width - padding * 2 - 40;
  const maxLines = 5;
  let fontSize = DESIGN.reelSize;
  let lines;
  for (;;) {
    ctx.font = `bold ${fontSize}px ${HEADLINE_FONT}`;
    lines = wrapTokens(ctx, tokenizeEmphasis(text), maxTextWidth);
    if (lines.length <= maxLines || fontSize <= 46) break;
    fontSize -= 6;
  }
  const lineHeight = fontSize + 16;
  const blockHeight = lines.length * lineHeight;

  // sit the block in the safe band (~30–66% of height): above the caption zone,
  // below the progress bar / logo, biased just under center for a native feel.
  const bandTop = height * 0.30, bandBot = height * 0.66;
  const startY = Math.min(bandBot - blockHeight, Math.max(bandTop, (height - blockHeight) / 2 + 40));
  ctx.textBaseline = 'top';
  lines.forEach((ln, i) => drawTokenLine(ctx, ln, width / 2, startY + i * lineHeight, headlineColor, accent));

  // final beat: a subtle "tap" chevron low in frame (the real CTA is the caption)
  if (isCta) {
    ctx.font = `bold ${Math.round(DESIGN.reelSize * 0.7)}px ${HEADLINE_FONT}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.fillText('↓', width / 2, height - padding * 2.2);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return canvas.toBuffer('png');
}

// ── kinetic reel frame (word-by-word typography) ─────────────────────────────
// One reveal-state of a kinetic reel. `text` is the FULL beat line (with any
// *emphasis*); layout is computed from the full token set every call so words
// stay pinned in place as they appear (no reflow). Two modes:
//   • karaoke: words 0..revealCount-1 shown; the active word (+ any *emphasis*
//     word already passed) is accent-colored, the rest base color.
//   • punch:   only the active word, big and centered.
// lib/reel.js renders one of these per word and holds each for its duration.

// place the full token set into centered lines; returns each token's draw x/y
// and its global index, so a caller can reveal/color an arbitrary subset.
function layoutTokens(ctx, tokens, maxWidth, cx, startY, lineHeight) {
  const indexed = tokens.map((t, i) => ({ ...t, i }));
  const lines = wrapTokens(ctx, indexed, maxWidth);
  const space = ctx.measureText(' ').width;
  const placed = [];
  lines.forEach((line, li) => {
    const widths = line.map(t => ctx.measureText(t.word).width);
    const total  = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    let x = cx - total / 2;
    const y = startY + li * lineHeight;
    line.forEach((t, k) => { placed.push({ token: t, x, y }); x += widths[k] + space; });
  });
  return { placed, lineCount: lines.length };
}

async function renderReelWordFrame({ text, revealCount, activeIndex, mode = 'karaoke',
                                     beatNum, total, paletteKey, productKey, isCta }) {
  const width = DESIGN.reelWidth, height = DESIGN.reelHeight, padding = DESIGN.padding;
  const palette = getPalette(paletteKey);
  const canvas  = new Canvas(width, height);
  const ctx     = canvas.getContext('2d');

  const { headlineColor } = await drawBackground(ctx, width, height, palette, productKey);
  const accent = readableAccent(palette, headlineColor);
  drawVignette(ctx, width, height);
  await renderBrand(ctx, width, palette, headlineColor);
  if (total > 1) drawProgressBar(ctx, width, beatNum, total, accent, padding);

  const allTokens = tokenizeEmphasis(text);
  ctx.textBaseline = 'top';

  if (mode === 'punch') {
    // one big centered word (the active one); emphasized words get the accent
    const tk = allTokens[Math.max(0, Math.min(activeIndex, allTokens.length - 1))] || { word: '', em: false };
    const maxTextWidth = width - padding * 2 - 40;
    let fontSize = Math.round(DESIGN.reelSize * 1.4);
    ctx.font = `bold ${fontSize}px ${HEADLINE_FONT}`;
    while (ctx.measureText(tk.word).width > maxTextWidth && fontSize > 54) {
      fontSize -= 8; ctx.font = `bold ${fontSize}px ${HEADLINE_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = tk.em ? accent : headlineColor;
    ctx.fillText(tk.word, width / 2, height / 2 - fontSize / 2 + 30);
  } else {
    // karaoke: frozen full-line layout, reveal a prefix, highlight active/emphasis
    const maxTextWidth = width - padding * 2 - 40;
    const maxLines = 5;
    let fontSize = DESIGN.reelSize;
    let lineCount;
    for (;;) {
      ctx.font = `bold ${fontSize}px ${HEADLINE_FONT}`;
      lineCount = wrapTokens(ctx, allTokens, maxTextWidth).length;
      if (lineCount <= maxLines || fontSize <= 46) break;
      fontSize -= 6;
    }
    const lineHeight  = fontSize + 16;
    const blockHeight = lineCount * lineHeight;
    const bandTop = height * 0.30, bandBot = height * 0.66;
    const startY = Math.min(bandBot - blockHeight, Math.max(bandTop, (height - blockHeight) / 2 + 40));

    ctx.font = `bold ${fontSize}px ${HEADLINE_FONT}`;
    const { placed } = layoutTokens(ctx, allTokens, maxTextWidth, width / 2, startY, lineHeight);
    ctx.textAlign = 'left';
    const shown = (revealCount == null) ? allTokens.length : revealCount;
    for (const p of placed) {
      if (p.token.i >= shown) continue; // not revealed yet — space is reserved
      ctx.fillStyle = (p.token.i === activeIndex || p.token.em) ? accent : headlineColor;
      ctx.fillText(p.token.word, p.x, p.y);
    }
  }

  if (isCta) {
    ctx.font = `bold ${Math.round(DESIGN.reelSize * 0.7)}px ${HEADLINE_FONT}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.fillText('↓', width / 2, height - padding * 2.2);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return canvas.toBuffer('png');
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
  renderReelFrame,
  renderReelWordFrame,
  tokenizeEmphasis,
  selectTemplate,
  renderFallback,
  getPalette,
  productImagePath,
  wrapText,
  DESIGN,
};
