'use strict';

// Buffer API v1 helpers — identical to Milly's implementation
// docs: buffer.com/developers/api

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const nodeFetch = require('node-fetch');
const fs        = require('fs');
const path      = require('path');

const BASE_URL = 'https://api.bufferapp.com/1';

function isConfigured() {
  return !!process.env.BUFFER_ACCESS_TOKEN;
}

function getToken() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error('BUFFER_ACCESS_TOKEN is not set.');
  return token;
}

async function getInstagramProfileId() {
  if (process.env.BUFFER_INSTAGRAM_PROFILE_ID) {
    return process.env.BUFFER_INSTAGRAM_PROFILE_ID;
  }
  const token = getToken();
  const res   = await nodeFetch(`${BASE_URL}/profiles.json?access_token=${token}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buffer profiles fetch failed (${res.status}): ${body}`);
  }
  const profiles  = await res.json();
  const instagram = Array.isArray(profiles) && profiles.find(p =>
    p.service === 'instagram' || p.service_type === 'instagram'
  );
  if (!instagram) {
    throw new Error('No Instagram profile found in Buffer. Connect Instagram at buffer.com/channels.');
  }
  return instagram.id;
}

async function uploadImage(imagePath) {
  const token       = getToken();
  const imageBuffer = fs.readFileSync(imagePath);
  const blob        = new Blob([imageBuffer], { type: 'image/png' });
  const form        = new FormData();
  form.append('access_token', token);
  form.append('photo', blob, path.basename(imagePath));

  const res = await globalThis.fetch(`${BASE_URL}/media/upload.json`, {
    method: 'POST',
    body:   form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buffer image upload failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data?.media?.picture || data?.picture || null;
}

async function schedulePost({ imagePaths, caption, scheduledAt }) {
  const token     = getToken();
  const profileId = await getInstagramProfileId();

  let photoUrl = null;
  if (imagePaths && imagePaths.length > 0) {
    try {
      photoUrl = await uploadImage(imagePaths[0]);
    } catch (err) {
      console.warn(`  Image upload skipped (${err.message}) — post will be text-only.`);
    }
  }

  const params = new URLSearchParams();
  params.append('access_token', token);
  params.append('profile_ids[]', profileId);
  params.append('text', caption);
  if (photoUrl)    params.append('media[photo]', photoUrl);
  if (scheduledAt) params.append('scheduled_at', scheduledAt);

  const res = await nodeFetch(`${BASE_URL}/updates/create.json`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buffer create update failed (${res.status}): ${body}`);
  }
  const data     = await res.json();
  const updateId = data?.updates?.[0]?.id || data?.update?.id || data?.id;
  return { success: true, updateId };
}

module.exports = { isConfigured, schedulePost, getInstagramProfileId };
