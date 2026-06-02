'use strict';

// PostPeer API helpers
// docs: postpeer.dev
// free tier: 20 posts/month — covers 3-4x/week at launch
// if PostPeer is not configured, scheduler falls back to /output/queue/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const fs    = require('fs');

const BASE_URL = 'https://api.postpeer.dev/v1';

function getHeaders() {
  const apiKey = process.env.POSTPEER_API_KEY;
  if (!apiKey) throw new Error('POSTPEER_API_KEY is not set.');
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  };
}

// check if PostPeer is configured (key + account ID both set)
function isConfigured() {
  return !!(process.env.POSTPEER_API_KEY && process.env.POSTPEER_ACCOUNT_ID);
}

// upload a local image file and return the PostPeer media ID
async function uploadMedia(imagePath) {
  const apiKey = process.env.POSTPEER_API_KEY;
  if (!apiKey) throw new Error('POSTPEER_API_KEY is not set.');

  const FormData = (await import('node-fetch')).FormData;
  const { Blob }  = require('buffer');

  const imageBuffer = fs.readFileSync(imagePath);
  const blob        = new Blob([imageBuffer], { type: 'image/png' });
  const form        = new FormData();
  form.append('file', blob, require('path').basename(imagePath));
  form.append('account_id', process.env.POSTPEER_ACCOUNT_ID);

  const res = await fetch(`${BASE_URL}/media/upload`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostPeer media upload failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.id || data.media_id;
}

// schedule a post to go live at a specific UTC datetime
// imagePaths: array of local file paths (carousel = multiple, single post = one)
// caption: full caption text including hashtags
// scheduledAt: ISO datetime string (UTC)
async function schedulePost({ imagePaths, caption, scheduledAt }) {
  const accountId = process.env.POSTPEER_ACCOUNT_ID;
  if (!accountId) throw new Error('POSTPEER_ACCOUNT_ID is not set.');

  // upload all images
  const mediaIds = [];
  for (const imgPath of imagePaths) {
    const mediaId = await uploadMedia(imgPath);
    mediaIds.push(mediaId);
  }

  const payload = {
    account_id:   accountId,
    media_ids:    mediaIds,
    caption:      caption,
    scheduled_at: scheduledAt,
    post_type:    mediaIds.length > 1 ? 'carousel' : 'image',
  };

  const res = await fetch(`${BASE_URL}/posts`, {
    method:  'POST',
    headers: getHeaders(),
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostPeer schedule failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { success: true, postId: data.id || data.post_id };
}

// get the status of a scheduled post
async function getPostStatus(postId) {
  const res = await fetch(`${BASE_URL}/posts/${postId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`PostPeer status check failed (${res.status})`);
  return res.json();
}

module.exports = { isConfigured, schedulePost, uploadMedia, getPostStatus };
