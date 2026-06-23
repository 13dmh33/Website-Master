/**
 * scout-shared — utilities used by both Scout modes (no-website / has-website).
 * Pulled out of scripts/scout.js verbatim during the mode-split refactor —
 * behavior is byte-for-byte identical to the pre-refactor inline versions.
 */

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function channelForTrade(t) {
  const map = {
    plumber:     'sms',
    hvac:        'sms',
    electrician: 'sms',
    roofer:      'sms',
    handyman:    'ig_dm'
  };
  return map[t.toLowerCase()] || 'sms';
}

// Detect social-media-only "websites" — not a real web presence.
// Used by no-website mode's "has real site" filter. Do not change this
// regex — no-website mode's golden-fixture test locks its exact behavior.
function isSocialOnlySite(site) {
  if (!site) return false;
  return /facebook\.com|instagram\.com|yelp\.com\/biz|nextdoor\.com|thumbtack\.com/i.test(site);
}

module.exports = { slugify, channelForTrade, isSocialOnlySite };
