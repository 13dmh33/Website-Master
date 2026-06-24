'use strict';

// dm-autoresponder.js — keyword → on-brand reply logic for Instagram DMs.
//
// Pure logic, no network. A live handler (Meta Graph API webhook on Mac, or a
// ManyChat flow) calls detectIntent() on an inbound message and buildReply() to
// get Riley's response + the tracked shop link. Brand-safe: never offers free
// product, discounts, or giveaways (see brand-voice.json voice_rules.dont).
//
// The reply also opens the door to email capture (the highest-ROI owned channel
// at low follower counts) WITHOUT being pushy — one soft line, never a second CTA
// stacked on the shop link.

const links = require('./links');

const KEYWORD = (process.env.DM_KEYWORD || 'PINK').toUpperCase();

// classify an inbound DM. Returns { matched, kind, keyword }.
//   kind: 'shop'      → they want the link (keyword or clear buying intent)
//         'size_help' → they're asking about sizing/fit
//         'none'      → no automated reply (hand to a human)
function detectIntent(text = '') {
  const t = String(text).toLowerCase();

  // sizing / fit questions take priority — they're further down the funnel
  if (/\b(size|sizing|fit|true to size|small|medium|large|xl|measurements?)\b/.test(t)) {
    return { matched: true, kind: 'size_help', keyword: null };
  }

  const kw = KEYWORD.toLowerCase();
  const hitKeyword = new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`).test(t) || t.includes('🩷') || t.includes('💗');
  const buyingIntent = /\b(link|shop|buy|store|where.*(get|buy)|how much|price|order)\b/.test(t);

  if (hitKeyword || buyingIntent) return { matched: true, kind: 'shop', keyword: hitKeyword ? KEYWORD : null };
  return { matched: false, kind: 'none', keyword: null };
}

// build the reply. Returns { messages: [...], link, captureEmail } where
// messages are sent in order (most IG/ManyChat flows send 1-2 short bubbles).
function buildReply({ kind = 'shop', captureEmail = true, firstName = '' } = {}) {
  const link = links.dmLink();
  const hey = firstName ? `Hey ${firstName}!` : 'Hey babe!';

  if (kind === 'size_help') {
    const messages = [
      `${hey} Great question 💪 Sizing's on each product page here 👉 ${link}`,
      `Our tees run true to size (size up if you like room over the work layers). Tell me which piece you're eyeing and I'll point you to the chart 🩷`,
    ];
    return { messages, link, captureEmail: false };
  }

  // default: shop
  const messages = [
    `${hey} Here's the shop 👉 ${link}`,
    `Every order sends 30% to breast cancer research — you're funding the fight just by repping it 🩷🔧`,
  ];
  if (captureEmail) {
    messages.push(`Want first dibs on new drops? Reply with your email and I'll add you to the list — no spam, just the good stuff.`);
  }
  return { messages, link, captureEmail };
}

// extract an email from a free-text DM reply (for list capture), or null.
function extractEmail(text = '') {
  const m = String(text).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

// a ManyChat-importable keyword-flow spec (no-code path for IG DM automation).
// ManyChat free tier is the realistic way to run this without a server.
function manychatFlow() {
  const shop = buildReply({ kind: 'shop' });
  const size = buildReply({ kind: 'size_help' });
  return {
    _note: 'Reference flow for ManyChat (or Meta Graph API). Keyword trigger → text bubbles below. Link is UTM-tagged for attribution.',
    keyword: KEYWORD,
    also_triggers_on: ['link', 'shop', 'buy', '🩷'],
    link: shop.link,
    flows: {
      shop: { trigger: KEYWORD, messages: shop.messages, then: 'capture_email_optin' },
      size_help: { trigger: 'size/fit question', messages: size.messages },
    },
    email_capture: {
      prompt: 'Reply with your email for first dibs on drops.',
      store_to: 'newsletter list (Buttondown / Mailchimp free tier)',
    },
    brand_safety: 'Never promise free product, discounts, or giveaways in any reply.',
  };
}

module.exports = {
  KEYWORD,
  detectIntent,
  buildReply,
  extractEmail,
  manychatFlow,
};
