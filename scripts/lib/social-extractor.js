'use strict';
/**
 * social-extractor — the ONE shared contact + social-profile extractor.
 *
 * Both enrichment paths pull socials/contact fields through this single module so
 * the regex/URL-pattern logic lives in exactly one place:
 *   • contact-scraper.js  --deep   (crawls the lead's own website)
 *   • directory-scraper.js --directories (BBB & other trade-directory profiles)
 *
 * The pure extraction primitives are already battle-tested inside
 * scripts/contact-scraper.js (they power --deep). contact-scraper.js is a locked
 * pipeline file — "zero modification" per the project's pipeline-integrity rule —
 * so rather than fork/duplicate that logic, this module RE-EXPORTS those primitives
 * (genuinely one implementation, shared by both paths) and layers a single
 * normalized entry point on top for callers that just want a clean result object.
 *
 * Importing contact-scraper.js has no side effects: its main() only runs under
 * `require.main === module`, so requiring it here is free.
 *
 * Extracted networks: facebook, instagram, linkedin, twitter (x), youtube, tiktok,
 * yelp, google, bbb, angi, nextdoor. Sources per page: mailto/plain-text/JSON-LD/
 * Cloudflare-cfemail/"info [at] biz [dot] com" for email; tel:/JSON-LD/US-regex for
 * phone; JSON-LD founder+employee / alt·title attrs / role-adjacent text for names;
 * hrefs + JSON-LD sameAs for socials.
 */

const cs = require('../contact-scraper');

/**
 * Normalize one page of HTML into a clean contact block.
 * @param {string} html         raw HTML of a single page (lead site OR directory profile)
 * @param {object} [opts]
 * @param {string} [opts.host]  bare host of the business site (e.g. "acme.com"), used to
 *                              prefer an on-domain email over a role/3rd-party address.
 * @returns {{ email: string|null, phone: string|null, contact_name: string|null,
 *             socials: object|null }}
 */
function extractContact(html, { host = null } = {}) {
  const g = cs.extractAllFromPage(html, host);
  const phones = [...new Set([...(g.strongPhones || []), ...(g.weakPhones || [])])];
  return {
    email:        cs.pickBest(g.emails, host),
    phone:        phones[0] || null,
    contact_name: (g.names || []).find(Boolean) || null,
    socials:      g.socials && Object.keys(g.socials).length ? g.socials : null,
  };
}

/** Just the social profiles on a page → { network: url, ... } or null. */
function extractSocials(html) {
  return cs.extractSocials(html);
}

/** "facebook: https://… | instagram: https://…" — the Sheet/CRM cell format. */
function formatSocials(socials) {
  if (!socials || typeof socials !== 'object') return '';
  return Object.entries(socials)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' | ');
}

/** Merge social objects; first non-empty value per network wins. */
function mergeSocials(...objs) {
  return cs.mergeSocials(...objs);
}

module.exports = {
  extractContact,
  extractSocials,
  formatSocials,
  mergeSocials,
  // low-level primitives re-exported so both paths share one implementation
  normalizePhone:     cs.normalizePhone,
  normHost:           cs.normHost,
  websiteOf:          cs.websiteOf,
  pickBest:           cs.pickBest,
  extractAllFromPage: cs.extractAllFromPage,
  classifySocial:     cs.classifySocial,
  socialNetworkOf:    cs.socialNetworkOf,
  extractJsonLd:      cs.extractJsonLd,
  harvestJsonLd:      cs.harvestJsonLd,
  extractEmails:      cs.extractEmails,
  stripTags:          cs.stripTags,
};
