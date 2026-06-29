/**
 * scout-has-website — new Scout mode. Finds established contractors who
 * already have a real website + email, captures site_url, and emits
 * leads shaped for /audit/input/leads.csv (business_name,trade,city,url,email).
 *
 * Does NOT touch scout-no-website.js's filters/scoring/output — additive only.
 */

const { slugify, normalizeDomain } = require('./scout-shared');

// Broader than no-website's isSocialOnlySite on purpose: this mode needs to
// reject Linktree/Google-Business/Yelp-profile "sites" too, since a site
// this thin isn't worth auditing. Kept separate from isSocialOnlySite so the
// no-website filter's behavior (and its golden fixture) never changes.
const PLATFORM_ONLY_PATTERN =
  /facebook\.com|instagram\.com|yelp\.com\/biz|nextdoor\.com|thumbtack\.com|linktr\.ee|linktree\.com|g\.page|business\.google\.com|maps\.google\.com|goo\.gl\/maps|m\.me\//i;

function isPlatformOnlyUrl(site) {
  return PLATFORM_ONLY_PATTERN.test(site);
}

function isRealWebsite(site) {
  if (!site || site.trim() === '') return false;
  return !isPlatformOnlyUrl(site);
}

function scoreFit(result) {
  let score = 0;

  // Review band proxies "established / can afford it" — no ceiling.
  const reviews = result.reviews || 0;
  if      (reviews >= 200) score += 4;
  else if (reviews >= 75)  score += 3;
  else if (reviews >= 25)  score += 2;
  else if (reviews >= 10)  score += 1;

  const rating = result.rating || 0;
  if      (rating >= 4.8) score += 2;
  else if (rating >= 4.5) score += 1;

  return Math.min(score, 10);
}

/**
 * Returns { leads, needsEmail, disc }.
 * `leads` = auditor-ready (has email). `needsEmail` = real site, no scrapeable
 * email — routed for manual lookup, never discarded.
 *
 * `knownDomains` (optional) catches the same business listed under a
 * different place_id (franchise relist, duplicate GBP listing) by matching
 * on normalized site domain — place_id dedup alone misses these.
 */
function filterAndFormatHasWebsite(results, tradeStr, cityStr, knownIds, minScore, knownDomains, minReviews = 10, minRating = 4.0) {
  let disc = { reviews: 0, rating: 0, noWebsite: 0, noPhone: 0, duplicate: 0, lowScore: 0 };
  const leads = [];
  const needsEmail = [];
  const seenDomainsThisRun = new Set();

  for (const r of results) {
    const pid = r.place_id;
    if (pid && knownIds.has(pid)) { disc.duplicate++; continue; }

    if (!r.reviews || r.reviews < minReviews) { disc.reviews++; continue; }
    if (!r.rating  || r.rating  < minRating)  { disc.rating++;  continue; }
    if (!r.phone   || r.phone.trim() === '') { disc.noPhone++; continue; }
    if (!isRealWebsite(r.site)) { disc.noWebsite++; continue; }

    const domain = normalizeDomain(r.site);
    if (domain && (
      (knownDomains && knownDomains.has(domain)) || seenDomainsThisRun.has(domain)
    )) { disc.duplicate++; continue; }

    const fit = scoreFit(r);
    if (fit < minScore) { disc.lowScore++; continue; }

    if (domain) seenDomainsThisRun.add(domain);

    const record = {
      lead_id:       r.place_id || `${slugify(r.name)}-${slugify(cityStr)}`,
      business_name: r.name || '',
      trade:         tradeStr,
      city:          cityStr,
      site_url:      r.site,
      email:         r.email ? r.email.trim() : '',
      phone:         r.phone || '',
      rating:        r.rating   || 0,
      review_count:  r.reviews  || 0,
      address:       r.full_address || '',
      place_id:      r.place_id || null,
      subtypes:      Array.isArray(r.subtypes) ? r.subtypes : (r.subtypes ? [r.subtypes] : []),
      latitude:      r.latitude  || null,
      longitude:     r.longitude || null,
      fit_score:     fit,
      gap_score:     fit, // alias — lets Diagnoser's existing sort/scoring work unmodified
      scraped_at:    new Date().toISOString()
    };

    if (record.email) leads.push(record);
    else needsEmail.push(record);
  }

  leads.sort((a, b) => b.fit_score - a.fit_score);
  needsEmail.sort((a, b) => b.fit_score - a.fit_score);

  return { leads, needsEmail, disc };
}

// Auditor-ready shape — feeds straight into /audit/input/leads.csv
function exportAuditorCsv(leads) {
  const header = 'business_name,trade,city,url,email';
  const rows = leads.map(l => [
    `"${l.business_name.replace(/"/g, '""')}"`,
    l.trade, l.city,
    l.site_url, l.email
  ].join(','));
  return [header, ...rows].join('\n');
}

function exportNeedsEmailCsv(needsEmail) {
  const header = 'business_name,trade,city,site_url,phone,address,place_id';
  const rows = needsEmail.map(l => [
    `"${l.business_name.replace(/"/g, '""')}"`,
    l.trade, l.city, l.site_url, l.phone,
    `"${l.address.replace(/"/g, '""')}"`,
    l.place_id || ''
  ].join(','));
  return [header, ...rows].join('\n');
}

module.exports = {
  isRealWebsite,
  isPlatformOnlyUrl,
  scoreFit,
  filterAndFormatHasWebsite,
  exportAuditorCsv,
  exportNeedsEmailCsv
};
