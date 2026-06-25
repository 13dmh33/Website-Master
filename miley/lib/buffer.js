'use strict';

// Buffer GraphQL API helpers (Techs4Tatas / Miley).
//
// Buffer retired issuance of classic v1 REST tokens — every token minted
// today (even from the "Legacy Apps" page) comes back as an OIDC token that
// the v1 REST API rejects. The only working surface now is the GraphQL API
// at https://api.buffer.com, authenticated with a personal API key from
// developers.buffer.com ("Get an API Key" — the key used here is the one
// named e.g. "Miley", scoped with at least posts:read/posts:write).
//
// Buffer (REST or GraphQL, always has) never accepts direct file uploads —
// media must already be a public URL. publishImage() below copies each
// rendered PNG into linkpage/posts/ so it's served by whatever static host
// LINKPAGE_URL points at, then hands that public URL to Buffer.
//
// Schema details (channels/organizations/createPost field names) are taken
// from developers.buffer.com docs as of this writing — if Buffer returns a
// "field not found" GraphQL error, paste it back so the mutation can be
// corrected against the live schema.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const GRAPHQL_URL = 'https://api.buffer.com';

function isConfigured() {
  return !!process.env.BUFFER_ACCESS_TOKEN;
}

function getToken() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error('BUFFER_ACCESS_TOKEN is not set (Buffer GraphQL personal API key from developers.buffer.com).');
  return token;
}

async function gql(query, variables) {
  const res = await globalThis.fetch(GRAPHQL_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.errors) {
    const detail = body?.errors ? JSON.stringify(body.errors) : `HTTP ${res.status}`;
    throw new Error(`Buffer GraphQL request failed: ${detail}`);
  }

  return body.data;
}

let cachedOrganizationId = null;

async function getOrganizationId() {
  if (cachedOrganizationId) return cachedOrganizationId;

  const data = await gql(`query GetOrganizations {
    account { organizations { id name } }
  }`);

  const org = data?.account?.organizations?.[0];
  if (!org) throw new Error('No Buffer organization found on this account.');

  cachedOrganizationId = org.id;
  return cachedOrganizationId;
}

// returns the @techs4tatas Instagram channel ID
// caches in BUFFER_INSTAGRAM_PROFILE_ID env var if set (avoids extra API calls)
async function getInstagramProfileId() {
  if (process.env.BUFFER_INSTAGRAM_PROFILE_ID) {
    return process.env.BUFFER_INSTAGRAM_PROFILE_ID;
  }

  const organizationId = await getOrganizationId();
  const data = await gql(`query GetChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id
      service
      displayName
    }
  }`, { organizationId });

  const channels = data?.channels || [];
  const instagram = channels.find(c => c.service === 'instagram');
  if (!instagram) {
    throw new Error('No Instagram channel found in Buffer. Connect @techs4tatas at buffer.com/channels first.');
  }

  return instagram.id;
}

// copies a locally rendered PNG into linkpage/posts/ so it's served by the
// same static host as LINKPAGE_URL, and returns the public URL Buffer needs
function publishImage(imagePath) {
  const linkpageUrl = process.env.LINKPAGE_URL;
  if (!linkpageUrl) {
    throw new Error('LINKPAGE_URL is not set — host the linkpage/ folder first, then set LINKPAGE_URL so post images have a public base URL.');
  }

  const postsDir = path.join(__dirname, '..', 'linkpage', 'posts');
  fs.mkdirSync(postsDir, { recursive: true });

  const filename = path.basename(imagePath);
  fs.copyFileSync(imagePath, path.join(postsDir, filename));

  const origin = new URL(linkpageUrl).origin;
  return `${origin}/posts/${filename}`;
}

// schedule one post via Buffer's GraphQL createPost mutation
// imagePaths: local file paths (uses first image; Buffer handles carousel scheduling)
// caption: full caption text
// scheduledAt: ISO 8601 UTC string
async function schedulePost({ imagePaths, caption, scheduledAt }) {
  const channelId = await getInstagramProfileId();

  const assets = [];
  if (imagePaths && imagePaths.length > 0) {
    try {
      assets.push({ url: publishImage(imagePaths[0]) });
    } catch (err) {
      console.warn(`  Image publish skipped (${err.message}) — post will be text-only.`);
    }
  }

  const data = await gql(`mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      post { id }
    }
  }`, {
    input: {
      channelId,
      text:           caption,
      assets,
      schedulingType: 'automatic',
      mode:           'customScheduled',
      dueAt:          scheduledAt,
    },
  });

  const postId = data?.createPost?.post?.id;
  return { success: true, updateId: postId };
}

module.exports = { isConfigured, schedulePost, getInstagramProfileId, publishImage };
