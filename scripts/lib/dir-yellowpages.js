/**
 * dir-yellowpages — Yellow Pages adapter for directory-scout.
 *
 * Why YP is the strongest source: each organic listing carries a
 * "Visit Website" link (<a class="track-visit-website">) pointing at the
 * contractor's OWN domain — exactly the field Google Maps omits ~65% of the
 * time. Feed those site_urls into contact-scraper.js and the email pipeline
 * fills itself.
 *
 * Search URL shape (public, no auth):
 *   https://www.yellowpages.com/search?search_terms=<trade>&geo_location_terms=<City, ST>&page=<n>
 *
 * parseListings is PURE (string in, array out) so it unit-tests against a saved
 * fixture with no network. The DOM selectors below reflect YP's current markup;
 * if YP reshuffles their HTML, only the regexes here change — the rest of the
 * pipeline is untouched. Verify selectors on the first live Mac run.
 */

'use strict';

const { isRealWebsite } = require('./scout-has-website');

const SOURCE = 'yellowpages';

// Any absolute http(s) link in a listing chunk that points at the contractor's
// own site — not YP itself, not a social/platform page, not a redirect shim.
// Used as the last-resort website extractor if YP renames its "Visit Website"
// class (strategy 3 in parseOne). Defensive against markup churn.
function firstExternalLink(chunk) {
  const re = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(chunk))) {
    const url = m[1];
    let host;
    try { host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch { continue; }
    if (/yellowpages\.com$/i.test(host) || /(^|\.)yp\.com$/i.test(host)) continue; // YP's own links
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;                                 // raw IPs = trackers
    if (!isRealWebsite(url)) continue;  // rejects facebook/instagram/yelp/etc.
    return url;
  }
  return null;
}

/** Build one search URL per page. `city` may be "Denver, CO" or just "Denver". */
function buildSearchUrls(trade, city, { pages = 2 } = {}) {
  const t = encodeURIComponent(trade);
  const c = encodeURIComponent(city);
  const urls = [];
  for (let p = 1; p <= pages; p++) {
    urls.push(`https://www.yellowpages.com/search?search_terms=${t}&geo_location_terms=${c}&page=${p}`);
  }
  return urls;
}

// Pull the href out of an <a> tag regardless of attribute order.
function hrefOf(anchorTag) {
  const m = /href\s*=\s*["']([^"']+)["']/i.exec(anchorTag);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&#38;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

/**
 * Split the results page into per-listing chunks. Each organic YP listing
 * begins at a `class="business-name"` anchor; a chunk runs from one such anchor
 * to the next (or end of body). Robust to surrounding markup changes.
 */
function splitListings(html) {
  const marker = /class="business-name"/g;
  const starts = [];
  let m;
  while ((m = marker.exec(html))) starts.push(m.index);
  const chunks = [];
  for (let i = 0; i < starts.length; i++) {
    // back up to the opening <a of this business-name anchor
    const from = html.lastIndexOf('<a', starts[i]);
    const to   = i + 1 < starts.length ? html.lastIndexOf('<a', starts[i + 1]) : html.length;
    chunks.push(html.slice(from < 0 ? starts[i] : from, to));
  }
  return chunks;
}

function parseOne(chunk) {
  // business name: text inside the business-name anchor (may be wrapped in a span)
  const nameM = /class="business-name"[^>]*>(?:\s*<[^>]+>)*\s*([^<]+)/i.exec(chunk);
  const business_name = nameM ? decodeEntities(nameM[1]) : '';
  if (!business_name) return null;

  // website: the "Visit Website" anchor's href (the contractor's own domain).
  // Three strategies, most-specific first, so a markup tweak doesn't zero us out:
  let site_url = null;
  //  (1) the canonical class, class-before-href
  const wm = /<a\b[^>]*class="[^"]*track-visit-website[^"]*"[^>]*>/i.exec(chunk);
  if (wm) site_url = hrefOf(wm[0]);
  //  (2) same class, any attribute order (href-before-class templates)
  if (!site_url) {
    const anchors = chunk.match(/<a\b[^>]*track-visit-website[^>]*>/gi) || [];
    for (const a of anchors) { const h = hrefOf(a); if (h) { site_url = h; break; } }
  }
  //  (3) fallback: any external <a> that isn't YP itself, a social/platform page,
  //      or a tel:/mailto:/anchor link. Catches the website even if YP renames the
  //      class. Takes the first such link in the listing (YP puts it near the top).
  if (!site_url) site_url = firstExternalLink(chunk);

  const phoneM = /class="phones phone primary"[^>]*>([^<]+)/i.exec(chunk);
  const phone = phoneM ? decodeEntities(phoneM[1]) : '';

  // review count lives in <span class="count">(NN)</span>
  const countM = /class="count"[^>]*>\s*\((\d+)\)/i.exec(chunk);
  const review_count = countM ? parseInt(countM[1], 10) : 0;

  // street address (+ locality) when present
  const streetM = /class="street-address"[^>]*>([^<]+)/i.exec(chunk);
  const localM  = /class="locality"[^>]*>([^<]+)/i.exec(chunk);
  const address = [streetM && decodeEntities(streetM[1]), localM && decodeEntities(localM[1])]
    .filter(Boolean).join(', ');

  return { business_name, site_url: site_url || '', phone, review_count, rating: 0, address };
}

/** PURE: full results HTML → array of rawListings. */
function parseListings(html) {
  if (!html) return [];
  return splitListings(html).map(parseOne).filter(Boolean);
}

module.exports = { SOURCE, buildSearchUrls, parseListings, splitListings, decodeEntities, firstExternalLink };
