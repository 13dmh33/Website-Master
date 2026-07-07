'use strict';

// instagram-publish.js — direct posting via the Instagram Graph API (no Buffer).
//
// Two-call flow per Meta docs: create a media container from a PUBLIC image URL,
// poll until Meta finishes fetching it, then publish. Carousels build one child
// container per slide, then a parent CAROUSEL container.
//
// Constraints that shape this module:
//   - image_url must be publicly reachable (Meta fetches it) — no binary upload.
//     scripts/publish-cards.js hosts the week's cards on the Netlify site first.
//   - JPEG only. publish-cards.js converts the PNG renders.
//   - Rate limit: 100 API-published posts per 24h per account (we post 4/week).
//
// Uses the same credentials as lib/instagram-insights.js:
//   INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID
// Works with the Meta app in Development mode as long as the IG account has a
// role on the app — no App Review needed for accounts you own.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES   = 20;   // ~60s — Meta usually finishes in a few seconds

function isConfigured() {
  return !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
}

function getToken()     { return process.env.INSTAGRAM_ACCESS_TOKEN; }
function getAccountId() { return process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID; }

async function graphPost(pathPart, params) {
  const body = new URLSearchParams({ access_token: getToken(), ...params });
  const res  = await fetch(`${GRAPH_BASE}/${pathPart}`, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Graph API POST /${pathPart} failed: ${msg}`);
  }
  return data;
}

async function graphGet(pathPart, params = {}) {
  const qs   = new URLSearchParams({ access_token: getToken(), ...params });
  const res  = await fetch(`${GRAPH_BASE}/${pathPart}?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Graph API GET /${pathPart} failed: ${msg}`);
  }
  return data;
}

// wait for a media container to finish (Meta fetches the image asynchronously)
async function waitForContainer(containerId) {
  for (let i = 0; i < POLL_MAX_TRIES; i++) {
    const { status_code: status } = await graphGet(containerId, { fields: 'status_code' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Media container ${containerId} status: ${status} — check the image URL is public JPEG.`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Media container ${containerId} not ready after ${POLL_MAX_TRIES * POLL_INTERVAL_MS / 1000}s.`);
}

// single-image post → returns the published IG media ID
async function publishSingle({ imageUrl, caption }) {
  const igUserId  = getAccountId();
  const container = await graphPost(`${igUserId}/media`, { image_url: imageUrl, caption: caption || '' });
  await waitForContainer(container.id);
  const published = await graphPost(`${igUserId}/media_publish`, { creation_id: container.id });
  return published.id;
}

// carousel post (2–10 images) → returns the published IG media ID
async function publishCarousel({ imageUrls, caption }) {
  const igUserId = getAccountId();
  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`Carousel needs 2–10 images, got ${imageUrls.length}.`);
  }

  const childIds = [];
  for (const url of imageUrls) {
    const child = await graphPost(`${igUserId}/media`, { image_url: url, is_carousel_item: 'true' });
    childIds.push(child.id);
  }
  for (const id of childIds) await waitForContainer(id);

  const parent = await graphPost(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children:   childIds.join(','),
    caption:    caption || '',
  });
  await waitForContainer(parent.id);
  const published = await graphPost(`${igUserId}/media_publish`, { creation_id: parent.id });
  return published.id;
}

// dispatch on image count → returns the published IG media ID
async function publishPost({ imageUrls, caption }) {
  if (!isConfigured()) throw new Error('Instagram Graph API not configured (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ACCOUNT_ID).');
  if (!imageUrls || !imageUrls.length) throw new Error('publishPost needs at least one image URL.');
  return imageUrls.length === 1
    ? publishSingle({ imageUrl: imageUrls[0], caption })
    : publishCarousel({ imageUrls, caption });
}

// cheap liveness check — fails when the token is expired/revoked.
// Long-lived Page tokens effectively don't expire, but a health warning here
// beats finding out on posting day.
async function checkTokenHealth() {
  try {
    const me = await graphGet(getAccountId(), { fields: 'id,username' });
    return { ok: true, username: me.username };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { isConfigured, publishPost, publishSingle, publishCarousel, checkTokenHealth };
