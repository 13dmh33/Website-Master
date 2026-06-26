/**
 * aggregator/lib/dedupe — dedup helpers for scraped aggregator orgs.
 * Dedup on normalized website domain first, then org_name + city.
 */

const { normalizeDomain } = require('../../scripts/lib/scout-shared');
const { slugify } = require('../../scripts/lib/scout-shared');

function orgKey(org) {
  return `${slugify(org.org_name || '')}|${slugify(org.city || '')}`;
}

// Builds the dedup index from previously scraped orgs (loaded from disk by caller).
function buildDedupeIndex(existingOrgs) {
  const domains = new Set();
  const keys = new Set();
  for (const org of existingOrgs) {
    const domain = normalizeDomain(org.website);
    if (domain) domains.add(domain);
    keys.add(orgKey(org));
  }
  return { domains, keys };
}

// Filters a batch of freshly scraped orgs against the dedupe index, and against
// itself (in case the same org turns up under two different search queries in
// the same run). Mutates the index in place so later batches in the same run
// see earlier ones.
function dedupeOrgs(orgs, index) {
  const kept = [];
  for (const org of orgs) {
    const domain = normalizeDomain(org.website);
    const key = orgKey(org);

    if (domain && index.domains.has(domain)) continue;
    if (!domain && index.keys.has(key)) continue;

    if (domain) index.domains.add(domain);
    index.keys.add(key);
    kept.push(org);
  }
  return kept;
}

module.exports = { orgKey, buildDedupeIndex, dedupeOrgs };
