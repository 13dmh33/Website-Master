'use strict';

// ig-config.js — which flavor of Meta's Instagram API this account uses.
// Adapted from Miley's proven module; tatas uses its own TATAS_-prefixed
// credentials (a second Instagram account on the same Meta app — never
// Miley's secrets).
//
// Two flavors, same endpoints, different host + login:
//
//   instagram (default) — "Instagram API with Instagram Login"
//     host graph.instagram.com · NO Facebook Page link needed. Long-lived
//     tokens last 60 days and must be refreshed (scripts/refresh-token.js /
//     the tatas-token-refresh workflow handle this).
//
//   facebook — the older "Instagram API with Facebook Login"
//     host graph.facebook.com · requires the IG account linked to a FB Page.
//     Page-derived tokens effectively don't expire.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MODE = (process.env.TATAS_IG_API_MODE || 'instagram').toLowerCase();

const GRAPH_BASE = MODE === 'facebook'
  ? 'https://graph.facebook.com/v19.0'
  : 'https://graph.instagram.com/v21.0';

module.exports = { MODE, GRAPH_BASE };
