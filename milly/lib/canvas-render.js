'use strict';

// design v2: editorial photo backgrounds via Unsplash + text overlay
// rationale: real editorial Instagram posts use photography, not flat color
// DESIGN_CONFIG controls all visual constants — change here, all images update
//
// to A/B test: swap overlay opacity (currently 0.58) — lighter = more photo, heavier = more readable
// to change font: update fontFamily below (system fonts only — no install needed)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Canvas, loadImage } = require('skia-canvas');
const fetch = require('node-fetch');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const DESIGN_CONFIG = {
  width:         1080,
  height:        1080,
  overlay:       'rgba(8, 15, 30, 0.62)',   // dark overlay on top of photo
  headline:      '#FFFFFF',
  body:          '#E2E8F0',
  accent:        '#1DA884',                  // teal
  muted:         'rgba(255,255,255,0.45)',
  fontFamily:    'Arial',
  headlineSize:  56,
  bodySize:      32,
  brandSize:     20,
  padding:       72,
  fallbackBg:    '#0B1120',                  // used if Unsplash fails
};

// niche → Unsplash search terms that produce editorial-quality images
const NICHE_PHOTO_QUERIES = {
  booking:    ['conference stage spotlight', 'auditorium empty seats', 'keynote speaker stage', 'microphone stage lights'],
  mindset:    ['ocean horizon sunrise', 'mountain path fog', 'empty road sunrise', 'lone tree field sunrise'],
  automation: ['city lights aerial night', 'modern office minimal', 'glass building reflection', 'technology abstract'],
  reevefound: ['conference hall chandelier', 'event venue empty', 'ballroom stage', 'hotel conference room'],
  reel:       ['spotlight stage empty', 'theater curtain', 'concert hall lights', 'stage fog lights'],
  carousel:   ['auditorium seats empty', 'conference hall wide', 'stage microphone podium', 'speaker hall light'],
};

// fetch a photo from Unsplash and return it as a loadable image
// falls back to null if Unsplash is not configured or request fails
async function fetchUnsplashPhoto(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=squarish&content_filter=high&client_id=${key}`;
    const res  = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;

    const data    = await res.json();
    const imgUrl  = data?.urls?.regular;
    if (!imgUrl) return null;

    // download the image to a temp file
    const imgRes  = await fetch(imgUrl, { timeout: 15000 });
    if (!imgRes.ok) return null;

    const buffer   = await imgRes.buffer();
    const tmpPath  = path.join(os.tmpdir(), `milly-bg-${Date.now()}.jpg`);
    fs.writeFileSync(tmpPath, buffer);

    const img = await loadImage(tmpPath);
    fs.unlinkSync(tmpPath);
    return img;
  } catch {
    return null;
  }
}

// get a random query for a given niche
function getPhotoQuery(niche) {
  const queries = NICHE_PHOTO_QUERIES[niche] || NICHE_PHOTO_QUERIES.mindset;
  return queries[Math.floor(Math.random() * queries.length)];
}

// draw background: photo + dark overlay, or flat color fallback
async function drawBackground(ctx, width, height, niche) {
  const query = getPhotoQuery(niche);
  const photo = await fetchUnsplashPhoto(query);

  if (photo) {
    // cover-fit the photo into the square canvas
    const scale  = Math.max(width / photo.width, height / photo.height);
    const drawW  = photo.width  * scale;
    const drawH  = photo.height * scale;
    const drawX  = (width  - drawW) / 2;
    const drawY  = (height - drawH) / 2;
    ctx.drawImage(photo, drawX, drawY, drawW, drawH);
  } else {
    ctx.fillStyle = DESIGN_CONFIG.fallbackBg;
    ctx.fillRect(0, 0, width, height);
  }

  // dark overlay for text legibility
  ctx.fillStyle = DESIGN_CONFIG.overlay;
  ctx.fillRect(0, 0, width, height);

  // subtle teal gradient at the bottom third for grounding
  const grad = ctx.createLinearGradient(0, height * 0.65, 0, height);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(8,15,30,0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// draw Reeve wordmark top-right
function renderReeveBrand(ctx, canvasWidth) {
  ctx.font         = `bold ${DESIGN_CONFIG.brandSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle    = DESIGN_CONFIG.accent;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('REEVE', canvasWidth - DESIGN_CONFIG.padding, DESIGN_CONFIG.padding);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// teal top bar
function renderTopBar(ctx, canvasWidth) {
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(0, 0, canvasWidth, 5);
}

// word wrap — returns final Y position
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

// render a single carousel slide
async function renderCarouselSlide(headline, body, slideNum, totalSlides, niche = 'booking') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  // slide counter
  ctx.font      = `${DESIGN_CONFIG.bodySize - 8}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.muted;
  ctx.fillText(`${slideNum} / ${totalSlides}`, padding, padding + 6);

  const contentY = padding + 130;

  // teal accent line before headline on slides 2+
  if (slideNum > 1) {
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillRect(padding, contentY - 20, 36, 3);
  }

  // headline
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = slideNum === 1 ? DESIGN_CONFIG.accent : DESIGN_CONFIG.headline;
  const afterHeadline = wrapText(ctx, headline, padding, contentY, width - padding * 2, DESIGN_CONFIG.headlineSize + 14);

  // body
  if (body) {
    ctx.font      = `${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.body;
    wrapText(ctx, body, padding, afterHeadline + 28, width - padding * 2, DESIGN_CONFIG.bodySize + 10);
  }

  // bottom teal accent
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// render a quote/caption post
async function renderQuotePost(mainText, attribution, niche = 'mindset') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  // large opening quote mark
  ctx.font      = `bold 110px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.globalAlpha = 0.7;
  ctx.fillText('"', padding - 6, height * 0.38);
  ctx.globalAlpha = 1;

  // main text
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize - 2}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  const endY = wrapText(ctx, mainText, padding, height * 0.4, width - padding * 2, DESIGN_CONFIG.headlineSize + 10);

  // attribution
  if (attribution) {
    ctx.font      = `${DESIGN_CONFIG.bodySize - 4}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillText(attribution, padding, endY + 28);
  }

  // bottom teal accent
  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// plain fallback if everything else fails
async function renderFallback(text, niche = 'mindset') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = DESIGN_CONFIG.fallbackBg;
  ctx.fillRect(0, 0, width, height);
  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  ctx.font      = `bold ${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  wrapText(ctx, text, padding, padding + 80, width - padding * 2, 44);

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

module.exports = {
  renderCarouselSlide,
  renderQuotePost,
  renderFallback,
  renderReeveBrand,
  wrapText,
  DESIGN_CONFIG,
  NICHE_PHOTO_QUERIES,
};
