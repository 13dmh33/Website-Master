'use strict';

// ig-config.js — which flavor of Meta's Instagram API this account uses.
// Shared by lib/instagram-publish.js and lib/instagram-insights.js.
//
// Two flavors, same endpoints, different host + login:
//
//   instagram (default) — "Instagram API with Instagram Login"
//     host graph.instagram.com · NO Facebook Page link needed — the app talks
//     to the IG professional account directly. Long-lived tokens last 60 days
//     and must be refreshed (scripts/refresh-token.js / miley-token-refresh
//     workflow handle this).
//
//   facebook — the older "Instagram API with Facebook Login"
//     host graph.facebook.com · requires the IG account linked to a FB Page.
//     Page-derived tokens effectively don't expire. Set INSTAGRAM_API_MODE=facebook
//     only if the account is already FB-linked and you prefer that setup.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MODE = (process.env.INSTAGRAM_API_MODE || 'instagram').toLowerCase();

const GRAPH_BASE = MODE === 'facebook'
  ? 'https://graph.facebook.com/v19.0'
  : 'https://graph.instagram.com/v21.0';

module.exports = { MODE, GRAPH_BASE };
