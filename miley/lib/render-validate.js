'use strict';

// render-validate.js — visual quality gate for canvas-render.js (Miley).
//
// Runs against the actual PNG bytes a render function is about to write/queue,
// so off-brand or broken cards never leave the pipeline unreviewed. Every
// render function in canvas-render.js calls validateRender() before returning
// its buffer; on failure the caller swaps in the plain-text fallback render
// instead (see canvas-render.js renderFallback()).
//
// Bypass: SKIP_VISUAL_GATE=true skips all checks (emergency use only) and logs
// loudly every time it fires.

const { Canvas, loadImage } = require('skia-canvas');

const DEFAULT_THRESHOLDS = {
  brandColorMinPixelPct: 0.05,  // at least 5% of pixels must match a brand color
  colorMatchTolerance:   28,    // per-channel RGB tolerance for "matches a brand color"
  edgeBleedPx:           2,     // ink found within this many px of the edge = overflow
  edgeBgTolerance:       60,    // wider tolerance for edge-vs-background since gradients drift
  minContrastBody:       4.5,   // WCAG AA body text
  minContrastLarge:      3.0,   // WCAG AA large text (>=24px-equivalent)
};

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function colorsClose(a, b, tolerance) {
  return Math.abs(a.r - b.r) <= tolerance &&
         Math.abs(a.g - b.g) <= tolerance &&
         Math.abs(a.b - b.b) <= tolerance;
}

// relative luminance (WCAG)
function luminance({ r, g, b }) {
  const srgb = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg) + 0.05;
  const l2 = luminance(bg) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

async function bufferToImageData(buffer) {
  const img = await loadImage(buffer);
  const canvas = new Canvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { ctx, width: img.width, height: img.height };
}

function pixelAt(imageData, width, x, y) {
  const i = (y * width + x) * 4;
  return { r: imageData[i], g: imageData[i + 1], b: imageData[i + 2], a: imageData[i + 3] };
}

// average color over a region — used as a cheap "what color is this area" probe
function averageColor(imageData, width, x0, y0, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const p = pixelAt(imageData, width, x, y);
      r += p.r; g += p.g; b += p.b; n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
}

// counts pixels (sampled on a stride grid for speed) matching any brand color
function brandColorPixelPct(imageData, width, height, brandColors, tolerance, stride = 4) {
  const targets = brandColors.map(hexToRgb).filter(Boolean);
  let matched = 0, sampled = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const p = pixelAt(imageData, width, x, y);
      sampled++;
      if (targets.some(t => colorsClose(p, t, tolerance))) matched++;
    }
  }
  return sampled ? matched / sampled : 0;
}

// is this region "blank" — i.e. nothing was drawn over the page background?
// When a known background color is supplied, blank means "fewer than ~0.5% of
// pixels differ from that background" — text/wordmark glyphs are thin strokes,
// so they barely move the region's *average* color even when clearly present;
// counting off-background pixels catches sparse glyphs that an average-color
// comparison would miss. Without a bg color, fall back to an internal-variance
// check (a flat single-color region = nothing drawn).
function regionIsBlank(imageData, width, x0, y0, w, h, tolerance, bgColor) {
  if (bgColor) {
    let offBg = 0, n = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const p = pixelAt(imageData, width, x, y);
        if (!colorsClose(p, bgColor, tolerance)) offBg++;
        n++;
      }
    }
    return n ? (offBg / n) < 0.005 : true;
  }

  const avg = averageColor(imageData, width, x0, y0, w, h);
  let variance = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const p = pixelAt(imageData, width, x, y);
      variance += Math.abs(p.r - avg.r) + Math.abs(p.g - avg.g) + Math.abs(p.b - avg.b);
      n++;
    }
  }
  // low average per-pixel deviation from the region's own mean = no rendered glyphs/shapes
  return n ? (variance / n) < tolerance : true;
}

// scans the outer edge ring for "ink" (anything that isn't the background or
// an explicitly allowed bleed color, e.g. the top accent bar) — a crude but
// real text-overflow tripwire. Allowed colors form a bounding box (not just
// discrete points) so in-between shades along a linear gradient between two
// allowed stops are also accepted — only genuinely off-palette pixels (stray
// text, overflowing glyphs) fall outside the box.
function edgeHasInk(imageData, width, height, edgePx, allowedColors, tolerance) {
  const box = {
    rMin: Math.min(...allowedColors.map(c => c.r)) - tolerance,
    rMax: Math.max(...allowedColors.map(c => c.r)) + tolerance,
    gMin: Math.min(...allowedColors.map(c => c.g)) - tolerance,
    gMax: Math.max(...allowedColors.map(c => c.g)) + tolerance,
    bMin: Math.min(...allowedColors.map(c => c.b)) - tolerance,
    bMax: Math.max(...allowedColors.map(c => c.b)) + tolerance,
  };
  const isInk = (p) =>
    p.r < box.rMin || p.r > box.rMax ||
    p.g < box.gMin || p.g > box.gMax ||
    p.b < box.bMin || p.b > box.bMax;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < edgePx; y++) { if (isInk(pixelAt(imageData, width, x, y))) return true; }
    for (let y = height - edgePx; y < height; y++) { if (isInk(pixelAt(imageData, width, x, y))) return true; }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < edgePx; x++) { if (isInk(pixelAt(imageData, width, x, y))) return true; }
    for (let x = width - edgePx; x < width; x++) { if (isInk(pixelAt(imageData, width, x, y))) return true; }
  }
  return false;
}

// regions: { wordmark: {x,y,w,h}, dimensions: {width,height},
//            backgroundColor: '#hex', textRegions: [{x,y,w,h,minContrast}] }
async function validateRender(buffer, templateName, opts = {}) {
  if (process.env.SKIP_VISUAL_GATE === 'true') {
    console.warn(`[render-validate] SKIP_VISUAL_GATE=true — bypassing the visual quality gate for "${templateName}". This should only ever happen in an emergency.`);
    return { pass: true, failures: [] };
  }

  const thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const failures = [];

  let width, height, ctx;
  try {
    const decoded = await bufferToImageData(buffer);
    width = decoded.width; height = decoded.height; ctx = decoded.ctx;
  } catch (err) {
    return { pass: false, failures: [`could not decode render buffer: ${err.message}`] };
  }

  if (opts.expectedWidth && opts.expectedHeight &&
      (width !== opts.expectedWidth || height !== opts.expectedHeight)) {
    failures.push(`dimensions incorrect: ${width}x${height}`);
  }

  const imageData = ctx.getImageData(0, 0, width, height).data;

  // brand colors present
  const brandColors = opts.brandColors || [];
  if (brandColors.length) {
    const pct = brandColorPixelPct(imageData, width, height, brandColors, thresholds.colorMatchTolerance);
    if (pct < thresholds.brandColorMinPixelPct) failures.push('brand color not detected');
  }

  // wordmark region non-blank
  if (opts.wordmarkRegion) {
    const { x, y, w, h } = opts.wordmarkRegion;
    const bg = opts.backgroundColor ? hexToRgb(opts.backgroundColor) : null;
    if (regionIsBlank(imageData, width, x, y, w, h, thresholds.colorMatchTolerance, bg)) {
      failures.push('wordmark region blank');
    }
  }

  // text overflow — ink found inside the edge bleed zone outside intentional bleed elements
  if (opts.backgroundColor) {
    const bg = hexToRgb(opts.backgroundColor);
    const allowed = [bg, ...((opts.allowedEdgeColors || []).map(hexToRgb).filter(Boolean))];
    if (bg && edgeHasInk(imageData, width, height, thresholds.edgeBleedPx, allowed, thresholds.edgeBgTolerance)) {
      failures.push('text overflow detected');
    }
  }

  // minimum contrast per declared text region
  for (const region of (opts.textRegions || [])) {
    const { x, y, w, h, fg, bg, large } = region;
    const fgColor = fg ? hexToRgb(fg) : averageColor(imageData, width, x, y, w, h);
    const bgColor = bg ? hexToRgb(bg) : (opts.backgroundColor ? hexToRgb(opts.backgroundColor) : null);
    if (!fgColor || !bgColor) continue;
    const ratio = contrastRatio(fgColor, bgColor);
    const minRatio = large ? thresholds.minContrastLarge : thresholds.minContrastBody;
    if (ratio < minRatio) failures.push(`contrast below threshold on ${region.name || 'text region'}`);
  }

  return { pass: failures.length === 0, failures };
}

module.exports = { validateRender, DEFAULT_THRESHOLDS, hexToRgb, contrastRatio, luminance };
