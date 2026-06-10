'use strict';

// Trevo Advisors design system
// Navy #0A1228 background, Teal #00C8AF accent
// editorial photo backgrounds via Unsplash + text overlay
// falls back to niche-specific gradients if Unsplash not configured

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Canvas, loadImage } = require('skia-canvas');
const fetch = require('node-fetch');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const DESIGN_CONFIG = {
  width:         1080,
  height:        1080,
  overlay:       'rgba(10, 18, 40, 0.65)',  // Trevo navy overlay
  headline:      '#FFFFFF',
  body:          '#E2E8F0',
  accent:        '#00C8AF',                  // Trevo teal
  muted:         'rgba(255,255,255,0.45)',
  fontFamily:    'Arial',
  headlineSize:  56,
  bodySize:      32,
  brandSize:     20,
  padding:       72,
  fallbackBg:    '#0A1228',                  // Trevo navy
};

const NICHE_PHOTO_QUERIES = {
  education:   ['contractor tools organized', 'plumber working professional', 'electrician wiring', 'hvac technician unit'],
  results:     ['contractor handshake homeowner', 'home renovation finished', 'happy homeowner renovation', 'contractor success'],
  product:     ['laptop website design desk', 'mobile phone website screen', 'modern website design', 'clean website mockup'],
  journey:     ['contractor startup small business', 'entrepreneur laptop coffee', 'small business owner portrait', 'tradesperson office'],
  carousel:    ['contractor tools overhead', 'home service professional', 'plumbing supplies neat', 'hvac equipment clean'],
  trevo_found: ['contractor new website', 'laptop phone website', 'website launch celebration', 'digital business launch'],
  reel:        ['contractor phone ringing', 'homeowner calling phone', 'tradesperson job site', 'contractor tools action'],
};

async function fetchUnsplashPhoto(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=squarish&content_filter=high&client_id=${key}`;
    const res  = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;

    const data   = await res.json();
    const imgUrl = data?.urls?.regular;
    if (!imgUrl) return null;

    const imgRes = await fetch(imgUrl, { timeout: 15000 });
    if (!imgRes.ok) return null;

    const buffer  = await imgRes.buffer();
    const tmpPath = path.join(os.tmpdir(), `molly-bg-${Date.now()}.jpg`);
    fs.writeFileSync(tmpPath, buffer);
    const img = await loadImage(tmpPath);
    fs.unlinkSync(tmpPath);
    return img;
  } catch {
    return null;
  }
}

function getPhotoQuery(niche) {
  const queries = NICHE_PHOTO_QUERIES[niche] || NICHE_PHOTO_QUERIES.education;
  return queries[Math.floor(Math.random() * queries.length)];
}

// niche-specific Trevo-branded gradient backgrounds
const NICHE_PALETTES = {
  education: {
    base: '#040A18',
    spotlight: { x: 0.60, y: 0.25, r: 0.55, color: 'rgba(0,200,175,0.20)' },
    rim:       { x: 0.10, y: 0.75, r: 0.40, color: 'rgba(0,136,112,0.14)' },
    topGrad:   ['rgba(10,18,40,0.0)', 'rgba(4,10,24,0.55)'],
  },
  results: {
    base: '#030D18',
    spotlight: { x: 0.50, y: 0.20, r: 0.65, color: 'rgba(0,200,175,0.22)' },
    rim:       { x: 0.80, y: 0.80, r: 0.45, color: 'rgba(0,136,112,0.16)' },
    topGrad:   ['rgba(0,60,50,0.20)', 'rgba(3,13,24,0.0)'],
  },
  product: {
    base: '#020812',
    spotlight: { x: 0.70, y: 0.20, r: 0.55, color: 'rgba(0,200,175,0.18)' },
    rim:       { x: 0.15, y: 0.75, r: 0.40, color: 'rgba(0,80,90,0.12)' },
    topGrad:   ['rgba(0,30,50,0.0)', 'rgba(2,8,18,0.65)'],
    grid: true,
  },
  journey: {
    base: '#060A1A',
    spotlight: { x: 0.50, y: 0.30, r: 0.60, color: 'rgba(0,180,160,0.20)' },
    rim:       { x: 0.20, y: 0.80, r: 0.40, color: 'rgba(0,136,112,0.14)' },
    topGrad:   ['rgba(10,18,40,0.25)', 'rgba(6,10,26,0.0)'],
  },
  carousel: {
    base: '#040A1A',
    spotlight: { x: 0.50, y: 0.18, r: 0.65, color: 'rgba(0,200,175,0.18)' },
    rim:       { x: 0.15, y: 0.80, r: 0.45, color: 'rgba(0,136,112,0.14)' },
    topGrad:   ['rgba(8,14,32,0.0)', 'rgba(4,10,26,0.60)'],
  },
  trevo_found: {
    base: '#040C1C',
    spotlight: { x: 0.50, y: 0.15, r: 0.60, color: 'rgba(0,200,175,0.24)' },
    rim:       { x: 0.85, y: 0.85, r: 0.40, color: 'rgba(0,136,112,0.14)' },
    topGrad:   ['rgba(0,40,35,0.22)', 'rgba(4,12,28,0.0)'],
  },
  reel: {
    base: '#020508',
    spotlight: { x: 0.50, y: 0.05, r: 0.55, color: 'rgba(0,200,175,0.20)' },
    rim:       { x: 0.85, y: 0.85, r: 0.40, color: 'rgba(0,136,112,0.12)' },
    topGrad:   ['rgba(0,0,0,0.0)', 'rgba(2,5,8,0.70)'],
  },
};

function drawGradientBackground(ctx, width, height, niche) {
  const p = NICHE_PALETTES[niche] || NICHE_PALETTES.education;

  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, width, height);

  const sx   = p.spotlight.x * width;
  const sy   = p.spotlight.y * height;
  const sr   = p.spotlight.r * Math.max(width, height);
  const spot = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  spot.addColorStop(0, p.spotlight.color);
  spot.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, width, height);

  const rx  = p.rim.x * width;
  const ry  = p.rim.y * height;
  const rr  = p.rim.r * Math.max(width, height);
  const rim = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
  rim.addColorStop(0, p.rim.color);
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, width, height);

  const mood = ctx.createLinearGradient(0, 0, 0, height);
  mood.addColorStop(0, p.topGrad[0]);
  mood.addColorStop(1, p.topGrad[1]);
  ctx.fillStyle = mood;
  ctx.fillRect(0, 0, width, height);

  if (p.grid) {
    ctx.strokeStyle = 'rgba(0,200,175,0.04)';
    ctx.lineWidth   = 1;
    const step      = 72;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
  }

  const vig = ctx.createLinearGradient(0, height * 0.55, 0, height);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
}

async function drawBackground(ctx, width, height, niche) {
  const query = getPhotoQuery(niche);
  const photo = await fetchUnsplashPhoto(query);

  if (photo) {
    const scale = Math.max(width / photo.width, height / photo.height);
    const drawW = photo.width  * scale;
    const drawH = photo.height * scale;
    ctx.drawImage(photo, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    ctx.fillStyle = DESIGN_CONFIG.overlay;
    ctx.fillRect(0, 0, width, height);
    const grad = ctx.createLinearGradient(0, height * 0.65, 0, height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(10,18,40,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    drawGradientBackground(ctx, width, height, niche);
  }
}

function renderTrevoBrand(ctx, canvasWidth) {
  ctx.font         = `bold ${DESIGN_CONFIG.brandSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('TREVO', canvasWidth - DESIGN_CONFIG.padding, DESIGN_CONFIG.padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function renderTopBar(ctx, canvasWidth) {
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(0, 0, canvasWidth, 5);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line    = '';
  let currentY = y;

  for (let i = 0; i < words.length; i++) {
    const testLine = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line, x, currentY);
      line     = words[i];
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

async function renderCarouselSlide(headline, body, slideNum, totalSlides, niche = 'education') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderTrevoBrand(ctx, width);

  ctx.font      = `${DESIGN_CONFIG.bodySize - 8}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.muted;
  ctx.fillText(`${slideNum} / ${totalSlides}`, padding, padding + 6);

  const contentY = padding + 130;

  if (slideNum > 1) {
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillRect(padding, contentY - 20, 36, 3);
  }

  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = slideNum === 1 ? DESIGN_CONFIG.accent : DESIGN_CONFIG.headline;
  const afterHeadline = wrapText(ctx, headline, padding, contentY, width - padding * 2, DESIGN_CONFIG.headlineSize + 14);

  if (body) {
    ctx.font      = `${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.body;
    wrapText(ctx, body, padding, afterHeadline + 28, width - padding * 2, DESIGN_CONFIG.bodySize + 10);
  }

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// Caption post — editorial style with hook + body paragraphs
async function renderCaptionPost(hookLine, bodyText, niche = 'results') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderTrevoBrand(ctx, width);

  // hook line in teal — large
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize - 4}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  const afterHook = wrapText(ctx, hookLine, padding, padding + 120, width - padding * 2, DESIGN_CONFIG.headlineSize + 8);

  // teal divider line
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, afterHook + 16, 48, 3);

  // body — first 3 sentences only (keep it readable)
  const sentences = bodyText.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
  ctx.font      = `${DESIGN_CONFIG.bodySize - 2}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.body;
  const afterBody = wrapText(ctx, sentences, padding, afterHook + 48, width - padding * 2, DESIGN_CONFIG.bodySize + 10);

  // attribution
  ctx.font      = `bold ${DESIGN_CONFIG.bodySize - 6}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText('— Trevo', padding, Math.min(afterBody + 36, height - padding - 20));

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// Trevo Found — site reveal card with features list
async function renderTrevoFoundPost(trade, city, features) {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, 'trevo_found');
  renderTopBar(ctx, width);

  // "JUST BUILT" badge
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.font         = `bold 18px ${DESIGN_CONFIG.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText('JUST BUILT', padding, padding + 8);
  ctx.textBaseline = 'alphabetic';

  // TREVO brand right-aligned
  ctx.font         = `bold ${DESIGN_CONFIG.brandSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('TREVO', width - padding, padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';

  // headline — trade is the product/demo name, city is the tagline or URL
  const headline = `${trade}`;
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  const afterHeadline = wrapText(ctx, headline, padding, padding + 140, width - padding * 2, DESIGN_CONFIG.headlineSize + 12);

  // subline (tagline or URL)
  ctx.font      = `${DESIGN_CONFIG.bodySize - 6}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText(city, padding, afterHeadline + 4);

  // divider
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(padding, afterHeadline + 28, width - padding * 2, 1);

  // features list
  let featureY = afterHeadline + 56;
  ctx.font      = `${DESIGN_CONFIG.bodySize - 2}px ${DESIGN_CONFIG.fontFamily}`;
  for (const feat of features.slice(0, 5)) {
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillText('→', padding, featureY);
    ctx.fillStyle = DESIGN_CONFIG.body;
    featureY = wrapText(ctx, feat, padding + 32, featureY, width - padding * 2 - 32, DESIGN_CONFIG.bodySize + 6);
    featureY += 6;
  }

  // footer
  ctx.font      = `bold ${DESIGN_CONFIG.bodySize - 6}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText("That's the build. — Trevo", padding, height - padding - 20);

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// Reel hook — bold single-line thumbnail
async function renderReelHook(hookLine, niche = 'reel') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);

  // "REEL" badge top-left
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.font         = `bold 18px ${DESIGN_CONFIG.fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText('REEL', padding, padding + 8);
  ctx.textBaseline = 'alphabetic';

  // TREVO brand right-aligned
  ctx.font         = `bold ${DESIGN_CONFIG.brandSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('TREVO', width - padding, padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';

  // big hook text — vertically centered
  ctx.font      = `bold 64px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  wrapText(ctx, hookLine, padding, height * 0.35, width - padding * 2, 78);

  // CTA subline
  ctx.font      = `${DESIGN_CONFIG.bodySize - 4}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillText('DM us the word  demo', padding, height - padding - 36);

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// kept for fallback compatibility
async function renderQuotePost(mainText, attribution, niche = 'results') {
  return renderCaptionPost(mainText, attribution || '', niche);
}

async function renderFallback(text, niche = 'education') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  drawGradientBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderTrevoBrand(ctx, width);

  ctx.font      = `bold ${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  wrapText(ctx, text, padding, padding + 80, width - padding * 2, 44);

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

module.exports = {
  renderCarouselSlide,
  renderCaptionPost,
  renderTrevoFoundPost,
  renderReelHook,
  renderQuotePost,
  renderFallback,
  renderTrevoBrand,
  wrapText,
  DESIGN_CONFIG,
  NICHE_PHOTO_QUERIES,
};
