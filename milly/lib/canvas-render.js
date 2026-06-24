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

// vertical canvas for Stories — same palette/brand system, taller frame
const STORY_WIDTH  = 1080;
const STORY_HEIGHT = 1920;

// A/B visual design variants — swap overlay opacity to test photo-forward vs text-forward legibility
// 'A' is the current production default; 'B' is the experiment
const DESIGN_VARIANTS = {
  A: { overlay: DESIGN_CONFIG.overlay },
  B: { overlay: 'rgba(8, 15, 30, 0.42)' }, // lighter overlay — more photo visible, tests legibility tradeoff
};

function getOverlay(variant) {
  return (DESIGN_VARIANTS[variant] || DESIGN_VARIANTS.A).overlay;
}

// niche → Unsplash search terms that produce editorial-quality images
const NICHE_PHOTO_QUERIES = {
  booking:    ['conference stage spotlight', 'auditorium empty seats', 'keynote speaker stage', 'microphone stage lights'],
  mindset:    ['ocean horizon sunrise', 'mountain path fog', 'empty road sunrise', 'lone tree field sunrise'],
  automation: ['city lights aerial night', 'modern office minimal', 'glass building reflection', 'technology abstract'],
  reevefound: ['conference hall chandelier', 'event venue empty', 'ballroom stage', 'hotel conference room'],
  reel:       ['spotlight stage empty', 'theater curtain', 'concert hall lights', 'stage fog lights'],
  carousel:   ['auditorium seats empty', 'conference hall wide', 'stage microphone podium', 'speaker hall light'],
  business:   ['contract signing desk', 'boardroom table empty', 'handshake business deal', 'executive office window'],
};

// fetch a photo from Unsplash and return it as a loadable image
// falls back to null if Unsplash is not configured or request fails
async function fetchUnsplashPhoto(query, orientation = 'squarish') {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  try {
    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=${orientation}&content_filter=high&client_id=${key}`;
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

// niche-specific canvas backgrounds — used when Unsplash is unavailable
// each palette evokes the visual mood of its niche without needing a photo
const NICHE_PALETTES = {
  booking: {
    // deep stage: dark navy base, warm off-center spotlight, cool rim
    base: '#04080F',
    spotlight: { x: 0.62, y: 0.28, r: 0.55, color: 'rgba(180,140,60,0.22)' },
    rim:       { x: 0.12, y: 0.72, r: 0.40, color: 'rgba(29,168,132,0.14)' },
    topGrad:   ['rgba(10,18,40,0.0)', 'rgba(4,8,15,0.55)'],
  },
  carousel: {
    base: '#040912',
    spotlight: { x: 0.5,  y: 0.20, r: 0.65, color: 'rgba(120,110,200,0.18)' },
    rim:       { x: 0.15, y: 0.80, r: 0.45, color: 'rgba(29,168,132,0.16)' },
    topGrad:   ['rgba(8,12,30,0.0)', 'rgba(4,9,18,0.60)'],
  },
  mindset: {
    // horizon: deep ocean blue fading to lighter blue-teal at top
    base: '#030B18',
    spotlight: { x: 0.50, y: 0.35, r: 0.70, color: 'rgba(29,100,168,0.28)' },
    rim:       { x: 0.80, y: 0.10, r: 0.50, color: 'rgba(60,190,180,0.15)' },
    topGrad:   ['rgba(20,60,100,0.30)', 'rgba(3,11,24,0.0)'],
  },
  automation: {
    // tech: near-black with subtle cool cyan tint, faint grid
    base: '#020608',
    spotlight: { x: 0.78, y: 0.22, r: 0.50, color: 'rgba(0,200,220,0.12)' },
    rim:       { x: 0.20, y: 0.78, r: 0.40, color: 'rgba(29,168,132,0.10)' },
    topGrad:   ['rgba(0,20,30,0.0)', 'rgba(2,6,8,0.65)'],
    grid: true,
  },
  reevefound: {
    // event venue: warm chandelier amber glow on dark navy
    base: '#060510',
    spotlight: { x: 0.50, y: 0.15, r: 0.60, color: 'rgba(220,160,40,0.20)' },
    rim:       { x: 0.15, y: 0.85, r: 0.35, color: 'rgba(180,80,40,0.10)' },
    topGrad:   ['rgba(30,20,5,0.25)', 'rgba(6,5,16,0.0)'],
  },
  reel: {
    // dramatic stage: single harsh spotlight from above
    base: '#020205',
    spotlight: { x: 0.50, y: 0.0,  r: 0.55, color: 'rgba(255,255,200,0.18)' },
    rim:       { x: 0.85, y: 0.85, r: 0.40, color: 'rgba(29,168,132,0.12)' },
    topGrad:   ['rgba(0,0,0,0.0)', 'rgba(2,2,5,0.70)'],
  },
  business: {
    // boardroom: warm charcoal base, amber/gold deal-making glow, teal rim
    base: '#080604',
    spotlight: { x: 0.55, y: 0.28, r: 0.58, color: 'rgba(210,150,40,0.22)' },
    rim:       { x: 0.08, y: 0.78, r: 0.40, color: 'rgba(29,168,132,0.14)' },
    topGrad:   ['rgba(35,22,5,0.22)', 'rgba(8,6,4,0.0)'],
  },
};

// draw a niche-specific editorial gradient background — no external images needed
function drawGradientBackground(ctx, width, height, niche) {
  const p = NICHE_PALETTES[niche] || NICHE_PALETTES.booking;

  // base fill
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, width, height);

  // primary spotlight — radial gradient
  const sx = p.spotlight.x * width;
  const sy = p.spotlight.y * height;
  const sr = p.spotlight.r * Math.max(width, height);
  const spot = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  spot.addColorStop(0, p.spotlight.color);
  spot.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, width, height);

  // rim light
  const rx = p.rim.x * width;
  const ry = p.rim.y * height;
  const rr = p.rim.r * Math.max(width, height);
  const rim = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
  rim.addColorStop(0, p.rim.color);
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, width, height);

  // top-to-bottom linear mood gradient
  const mood = ctx.createLinearGradient(0, 0, 0, height);
  mood.addColorStop(0, p.topGrad[0]);
  mood.addColorStop(1, p.topGrad[1]);
  ctx.fillStyle = mood;
  ctx.fillRect(0, 0, width, height);

  // faint grid for automation niche
  if (p.grid) {
    ctx.strokeStyle = 'rgba(0,200,220,0.04)';
    ctx.lineWidth = 1;
    const step = 72;
    for (let x = 0; x < width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
  }

  // bottom vignette — always grounds the text area
  const vig = ctx.createLinearGradient(0, height * 0.55, 0, height);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);
}

// draw background: Unsplash photo + dark overlay, or niche gradient fallback
async function drawBackground(ctx, width, height, niche, variant = 'A') {
  const query = getPhotoQuery(niche);
  const orientation = height > width ? 'portrait' : 'squarish';
  const photo = await fetchUnsplashPhoto(query, orientation);

  if (photo) {
    // cover-fit the photo into the square canvas
    const scale  = Math.max(width / photo.width, height / photo.height);
    const drawW  = photo.width  * scale;
    const drawH  = photo.height * scale;
    const drawX  = (width  - drawW) / 2;
    const drawY  = (height - drawH) / 2;
    ctx.drawImage(photo, drawX, drawY, drawW, drawH);

    // dark overlay for text legibility — opacity varies by A/B design variant
    ctx.fillStyle = getOverlay(variant);
    ctx.fillRect(0, 0, width, height);

    // bottom grounding gradient
    const grad = ctx.createLinearGradient(0, height * 0.65, 0, height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(8,15,30,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    // no photo available — use the niche-specific gradient background
    drawGradientBackground(ctx, width, height, niche);
  }
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
async function renderCarouselSlide(headline, body, slideNum, totalSlides, niche = 'booking', variant = 'A') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche, variant);
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
async function renderQuotePost(mainText, attribution, niche = 'mindset', variant = 'A') {
  const { width, height, padding } = DESIGN_CONFIG;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche, variant);
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

  drawGradientBackground(ctx, width, height, niche);
  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  ctx.font      = `bold ${DESIGN_CONFIG.bodySize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  wrapText(ctx, text, padding, padding + 80, width - padding * 2, 44);

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - padding, 44, 4);

  return canvas.toBuffer('png');
}

// behind-the-scenes Story — vertical 1080x1920, big centered text + sticker-style CTA
async function renderStorySlide(text, niche = 'mindset', cta = null, variant = 'A') {
  const width  = STORY_WIDTH;
  const height = STORY_HEIGHT;
  const padding = DESIGN_CONFIG.padding;
  const canvas = new Canvas(width, height);
  const ctx    = canvas.getContext('2d');

  await drawBackground(ctx, width, height, niche, variant);
  renderTopBar(ctx, width);
  renderReeveBrand(ctx, width);

  // centered headline-style text, mid-frame (Stories are read top-down with thumb near bottom)
  ctx.font      = `bold ${DESIGN_CONFIG.headlineSize}px ${DESIGN_CONFIG.fontFamily}`;
  ctx.fillStyle = DESIGN_CONFIG.headline;
  const endY = wrapText(ctx, text, padding, height * 0.42, width - padding * 2, DESIGN_CONFIG.headlineSize + 16);

  // CTA pill near the bottom, clear of Instagram's native sticker tray
  if (cta) {
    ctx.font      = `bold ${DESIGN_CONFIG.bodySize - 2}px ${DESIGN_CONFIG.fontFamily}`;
    ctx.fillStyle = DESIGN_CONFIG.accent;
    ctx.fillText(cta.toUpperCase(), padding, height * 0.84);
  }

  ctx.fillStyle = DESIGN_CONFIG.accent;
  ctx.fillRect(padding, height - 220, 44, 4);

  return canvas.toBuffer('png');
}

module.exports = {
  renderCarouselSlide,
  renderQuotePost,
  renderFallback,
  renderStorySlide,
  renderReeveBrand,
  wrapText,
  DESIGN_CONFIG,
  NICHE_PHOTO_QUERIES,
  STORY_WIDTH,
  STORY_HEIGHT,
  DESIGN_VARIANTS,
};
