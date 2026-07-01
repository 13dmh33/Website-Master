'use strict';

// unsplash.js — free stock-photo tier for Miley card backgrounds.
//
// Implements the 'stock_photo' rung of visual-config.json's image priority
// order (dave_product_mockups > dave_lifestyle_photos > ai_generated_lifestyle
// > stock_photo > gradient_fallback). Only the mockup tier and this one are
// actually wired up; the rest stay aspirational until built.
//
// Silent-fail by design (same pattern as lib/sources.js): no key, network
// error, or zero results just means the caller falls back to the gradient
// card. Never throws into the render pipeline.

const fs   = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'output', 'photo-cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week — keep variety, avoid hammering the API

function cachePathFor(query) {
  const safe = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return path.join(CACHE_DIR, `${safe}.jpg`);
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// content type / product → a search query that puts a relevant tradeswoman
// or product-adjacent scene in frame. Kept deliberately narrow — generic
// "construction" queries return mostly men; these terms bias toward women.
const QUERY_FOR_CONTENT_TYPE = {
  trades_humor:              'tradeswoman electrician plumber working',
  motivational:              'female construction worker confident',
  engagement:                'women in trades toolbelt jobsite',
  mission:                   'female plumber electrician portrait',
  mission_product_combo:     'female tradesworker toolbelt',
  mission_recap:             'women construction crew',
  awareness_stat:            'female tradesworker portrait',
  product_feature_single:    'tools workbench flat lay',
  product_feature_lifestyle: 'tradeswoman wearing work apparel',
  product_social_proof:      'tradeswoman smiling jobsite',
};

function queryFor(contentType, product) {
  if (product) return `tradeswoman ${product.replace(/_/g, ' ')}`;
  return QUERY_FOR_CONTENT_TYPE[contentType] || 'women in skilled trades';
}

// fetch a random photo buffer for `query`. Returns null on any failure
// (no key, offline, zero results) so the caller can fall back to gradient.
async function fetchStockPhoto(contentType, product) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const query = queryFor(contentType, product);
  ensureCacheDir();
  const cachePath = cachePathFor(query);

  try {
    if (fs.existsSync(cachePath) && (Date.now() - fs.statSync(cachePath).mtimeMs) < CACHE_TTL_MS) {
      return fs.readFileSync(cachePath);
    }

    const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=squarish&content_filter=high`;
    const res = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const photoUrl = json && json.urls && (json.urls.regular || json.urls.full);
    if (!photoUrl) return null;

    const imgRes = await fetch(photoUrl);
    if (!imgRes.ok) return null;
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    fs.writeFileSync(cachePath, buffer);
    return buffer;
  } catch {
    return null; // offline / rate-limited / malformed response — gradient fallback handles it
  }
}

module.exports = { fetchStockPhoto, queryFor };
