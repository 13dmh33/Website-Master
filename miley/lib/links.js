'use strict';

// links.js — single source of truth for trackable shop links (Miley / Techs4Tatas).
//
// The funnel:
//   Instagram bio link  → LINKPAGE (hub)  → storefront (per-product, UTM-tagged)
//   DM "PINK"           → LINKPAGE (hub)  → storefront
//   Linkpage buttons    → storefront with utm_content=<product key>
//
// Every outbound link carries UTM params so the destination's analytics
// (free GA4 / Meta Pixel on the linkpage, or ManyChat) can attribute clicks to
// a source, a campaign (month/october/pink), and a specific product. Per-post
// links in the IG feed aren't clickable, so attribution is coarse by design —
// the linkpage is the measurable choke point.

const STOREFRONT = normalizeUrl(process.env.STOREFRONT_URL || 'techs4tatas.printify.me');
const LINKPAGE   = normalizeUrl(process.env.LINKPAGE_URL || STOREFRONT); // until the hub is hosted, fall back to the store

// catalog key → display name (keys come from post-formats.json product_catalog_rotation)
const PRODUCTS = {
  unisex_tee:              'Unisex Black Tee',
  pocket_back_graphic_tee: 'Pocket & Back Graphic Tee',
  snapback_hat:            'Snapback',
  trucker_cap:             'Trucker Cap (pink logo)',
  boxer_briefs:            'Boxer Briefs',
  kiss_cut_sticker_1:      'Kiss-Cut Sticker',
  kiss_cut_sticker_2:      'Sticker',
  magnet:                  'Magnet',
};

function normalizeUrl(u) {
  if (!u) return '';
  const trimmed = String(u).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function productName(key) {
  return PRODUCTS[key] || (key ? String(key).replace(/_/g, ' ') : 'the shop');
}

// append UTM params to a base URL (skips blank values)
function withUtm(base, { source, medium, campaign, content, term } = {}) {
  if (!base) return base;
  const params = new URLSearchParams();
  if (source)   params.set('utm_source', source);
  if (medium)   params.set('utm_medium', medium);
  if (campaign) params.set('utm_campaign', campaign);
  if (content)  params.set('utm_content', content);
  if (term)     params.set('utm_term', term);
  const qs = params.toString();
  if (!qs) return base;
  return base + (base.includes('?') ? '&' : '?') + qs;
}

// the storefront with UTMs (linkpage buttons + DM use this)
function storeUrl(utm = {}) {
  return withUtm(STOREFRONT, { source: 'linkpage', medium: 'button', ...utm });
}

// the bio hub link (what goes in the Instagram bio)
function bioLink(utm = {}) {
  return withUtm(LINKPAGE, { source: 'instagram', medium: 'bio', ...utm });
}

// the link to hand out in a DM reply
function dmLink(utm = {}) {
  return withUtm(LINKPAGE, { source: 'instagram', medium: 'dm', campaign: 'pink', ...utm });
}

// resolve the tracked link + the human CTA phrasing for a given post.
// Community posts whose CTA is a comment/tag get no link (returns null link).
function forPost({ contentType = '', product = null, campaignMode = 'base' } = {}) {
  const drivesToShop = /^product|^mission|^awareness/.test(contentType);
  if (!drivesToShop) return { link: null, product: null, phrase: null };

  const campaign = campaignMode === 'october' ? 'october'
                 : campaignMode === 'september' ? 'awareness_buildup'
                 : 'evergreen';
  const link = bioLink({ campaign, content: product || contentType });
  const phrase = product
    ? `Tap the link in bio for the ${productName(product)} (or DM PINK).`
    : `Link in bio to shop — or DM PINK and I'll send it.`;
  return { link, product, phrase };
}

module.exports = {
  STOREFRONT,
  LINKPAGE,
  PRODUCTS,
  normalizeUrl,
  productName,
  withUtm,
  storeUrl,
  bioLink,
  dmLink,
  forPost,
};
