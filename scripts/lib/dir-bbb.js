/**
 * dir-bbb — Better Business Bureau adapter for directory-scout.
 *
 * BBB's public pages are JS-rendered (a plain HTML fetch returns an app shell),
 * so this adapter targets BBB's JSON search API instead — far more stable than
 * scraping rendered markup. Accredited/listed contractors skew established,
 * which is a good fit for a $100 site pitch.
 *
 * API shape (public, no auth; returns JSON):
 *   https://www.bbb.org/api/search?find_country=USA&find_text=<trade>&find_loc=<City, ST>&page=<n>
 *
 * Coverage caveat: the search payload includes name/phone/address for every
 * result but a website URL only for some. Results WITHOUT a website still flow
 * through as name+phone leads (routed to needs-email for Apollo/manual), so a
 * BBB run is never wasted — but Yellow Pages yields more site_urls per run.
 *
 * parseListings is PURE (JSON text or object in, array out) and unit-tests
 * against a saved fixture. BBB has renamed the results array over time
 * (results / searchResult), so we defensively find the first array whose items
 * look like businesses rather than hardcoding the key.
 */

'use strict';

const SOURCE = 'bbb';

function buildSearchUrls(trade, city, { pages = 2 } = {}) {
  const t = encodeURIComponent(trade);
  const c = encodeURIComponent(city);
  const urls = [];
  for (let p = 1; p <= pages; p++) {
    urls.push(`https://www.bbb.org/api/search?find_country=USA&find_text=${t}&find_loc=${c}&page=${p}`);
  }
  return urls;
}

// Depth-first search for the first array of objects that carry a business name.
function findResultsArray(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (Array.isArray(obj)) {
    if (obj.some(x => x && typeof x === 'object' && (x.businessName || x.business_name || x.name))) return obj;
    for (const el of obj) { const found = findResultsArray(el, depth + 1); if (found) return found; }
    return null;
  }
  for (const k of Object.keys(obj)) {
    const found = findResultsArray(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}

function firstString(obj, keys) {
  for (const k of keys) {
    if (obj[k] && typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  return '';
}

function composeAddress(item) {
  const direct = firstString(item, ['address', 'fullAddress', 'streetAddress']);
  if (direct) {
    const cityStr = firstString(item, ['city']);
    const stateStr = firstString(item, ['state', 'stateProvince']);
    return [direct, cityStr, stateStr].filter(Boolean).join(', ');
  }
  return [firstString(item, ['city']), firstString(item, ['state', 'stateProvince'])].filter(Boolean).join(', ');
}

/** PURE: JSON body (string or already-parsed object) → array of rawListings. */
function parseListings(body) {
  let data = body;
  if (typeof body === 'string') {
    try { data = JSON.parse(body); }
    catch { return []; }
  }
  const results = findResultsArray(data);
  if (!results) return [];

  return results.map(item => {
    const business_name = firstString(item, ['businessName', 'business_name', 'name']);
    if (!business_name) return null;
    // website appears under a few different keys depending on API version
    const site_url = firstString(item, ['websiteUrl', 'website', 'websiteURL', 'primaryWebsite']);
    const phone    = firstString(item, ['phone', 'primaryPhone', 'telephone']);
    const ratingRaw = item.stars ?? item.starsAsNumber ?? item.rating ?? 0;
    return {
      business_name,
      site_url: site_url || '',
      phone,
      rating: Number(ratingRaw) || 0,
      review_count: Number(item.reviewCount || item.numberOfReviews || 0) || 0,
      address: composeAddress(item),
    };
  }).filter(Boolean);
}

module.exports = { SOURCE, buildSearchUrls, parseListings, findResultsArray };
