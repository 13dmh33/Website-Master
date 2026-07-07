'use strict';

// Instagram Graph API — read-only analytics (posting lives in instagram-publish.js)
// requires an Instagram professional account + access token
// skip gracefully if INSTAGRAM_ACCESS_TOKEN is not set

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');

// host depends on the API flavor (Instagram Login vs Facebook Login) — see lib/ig-config.js
const { GRAPH_BASE } = require('./ig-config');

function isConfigured() {
  return !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
}

function getToken() {
  return process.env.INSTAGRAM_ACCESS_TOKEN;
}

function getAccountId() {
  return process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
}

// build a Graph API URL with the token attached
function url(path, params = {}) {
  const qs = new URLSearchParams({ access_token: getToken(), ...params });
  return `${GRAPH_BASE}/${path}?${qs}`;
}

// fetch recent media posted to the account
async function getRecentMedia(limit = 10) {
  const accountId = getAccountId();
  const res = await fetch(url(`${accountId}/media`, {
    fields: 'id,caption,media_type,timestamp,permalink',
    limit:  String(limit),
  }));
  if (!res.ok) throw new Error(`Failed to fetch media list (${res.status})`);
  const data = await res.json();
  return data.data || [];
}

// fetch insights for a single media object
// metrics: array of metric names
async function getMediaInsights(mediaId, metrics) {
  const res = await fetch(url(`${mediaId}/insights`, {
    metric: metrics.join(','),
  }));
  if (!res.ok) {
    // some media types don't support all metrics — return empty rather than crash
    console.warn(`Insights unavailable for media ${mediaId} (${res.status})`);
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

// pull insights for all posts from the past N days
// returns array of enriched post objects with engagement metrics attached
async function getWeeklyInsights(days = 7) {
  const media = await getRecentMedia(20);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const recentMedia = media.filter(m => new Date(m.timestamp) >= cutoff);
  if (!recentMedia.length) return [];

  const METRICS = ['impressions', 'reach', 'saved', 'profile_visits', 'likes', 'comments'];

  const enriched = [];
  for (const post of recentMedia) {
    try {
      const insights = await getMediaInsights(post.id, METRICS);

      const metricsMap = {};
      for (const insight of insights) {
        metricsMap[insight.name] = insight.values?.[0]?.value ?? 0;
      }

      const likes    = metricsMap.likes    || 0;
      const comments = metricsMap.comments || 0;
      const saves    = metricsMap.saved    || 0;
      const reach    = metricsMap.reach    || 1; // avoid div by zero

      const engagementRate = parseFloat(((likes + comments + saves) / reach * 100).toFixed(2));

      enriched.push({
        id:             post.id,
        permalink:      post.permalink,
        timestamp:      post.timestamp,
        caption:        (post.caption || '').slice(0, 120),
        impressions:    metricsMap.impressions    || 0,
        reach,
        saves,
        profile_visits: metricsMap.profile_visits || 0,
        likes,
        comments,
        engagementRate,
      });
    } catch (err) {
      console.warn(`Skipping insights for post ${post.id}: ${err.message}`);
    }
  }

  return enriched;
}

module.exports = { isConfigured, getRecentMedia, getMediaInsights, getWeeklyInsights };
