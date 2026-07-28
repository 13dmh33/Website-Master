'use strict';
/**
 * Lead-quality filters — keep non-prospects and junk emails out of the pipeline.
 * Built from real misfires on the 2026-07-26 Austin run, where contact-scraper
 * flipped supply houses and a Wix placeholder into "email leads" that then had
 * to be excluded by hand. Baked in here so every future scrape auto-filters.
 *
 * Trevo sells websites to home-service CONTRACTORS (plumber/electrician/handyman/
 * roofer). Supply houses, distributors, showrooms, and big-box stores are not
 * prospects. And a "found" email that's a template default (info@mysite.com) is
 * not a real inbox.
 */

// Template / placeholder / builder-default email needles — an email containing
// any of these is not a real business inbox.
const PLACEHOLDER_EMAIL_NEEDLES = [
  'mysite.com', 'wixsite', 'wix.com', 'yoursite', 'yourdomain', 'yourbusiness',
  'yourcompany', 'yourname', 'youremail', 'example.com', 'example.org',
  'domain.com', 'company.com', 'business.com', 'email.com', 'test@', 'sentry',
];

function isPlaceholderEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return true;
  return PLACEHOLDER_EMAIL_NEEDLES.some(n => e.includes(n));
}

// Third-party authors whose addresses routinely sit inside a contractor's page
// without being the contractor: font licence headers in CSS, theme credits,
// template demo content. Every entry below was observed in a real scrape —
// the 2026-07-28 Colorado Springs run harvested a font designer's personal
// Gmail and a WordPress theme demo address as if they were plumbers.
const BOILERPLATE_AUTHOR_NEEDLES = [
  'impallari',      // Pablo Impallari — Lobster/Playfair designer, in Google Fonts headers
  'astigmatic',     // Astigmatic One Eye Typographic Institute — font foundry
  'tidyhome',       // WordPress theme demo author
  'fontfabric', 'fontsquirrel', 'typekit', 'monotype', 'fonts.com', 'sil.org',
  'envato', 'themeforest', 'templatemonster', 'elementor', 'wpengine',
  'squarespace.com', 'godaddy.com', 'bootstrapmade', 'colorlib', 'themewagon',
];

/** An address belonging to a font foundry / theme author, not the business. */
function isBoilerplateAuthorEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  return BOILERPLATE_AUTHOR_NEEDLES.some(n => e.includes(n));
}

// Consumer mailbox providers. A small contractor legitimately runs their
// business off one of these, so an address here needs no domain match.
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
  'me.com', 'msn.com', 'live.com', 'comcast.net', 'sbcglobal.net', 'att.net',
  'verizon.net', 'cox.net', 'charter.net', 'bellsouth.net', 'protonmail.com',
]);

function registrableName(host) {
  if (!host) return '';
  return String(host).toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .slice(0, -1)          // drop the TLD
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * True when an email cannot plausibly belong to the business whose site it was
 * scraped from. A real contractor's address is either on their own domain or on
 * a consumer provider — never on some unrelated company's domain. Without this,
 * contact-scraper's pickBest() falls back to "any non-junk address on the page"
 * when no domain match exists, which is how third-party boilerplate gets in.
 *
 * Deliberately permissive about consumer providers (they carry no domain signal)
 * and about shared word stems, so a franchise or parent-company address still
 * passes. The cost asymmetry justifies the check: losing one borderline lead is
 * cheaper than cold-emailing a stranger, which is a real CAN-SPAM and sender-
 * reputation risk.
 */
// Only grammatical filler and legal suffixes. Trade words stay in deliberately —
// they are load-bearing for acronyms ("The Plumber from Down Under" -> pdu, which
// is exactly the abbreviation such an owner registers as their domain).
const NAME_STOPWORDS = new Set([
  'the', 'and', 'of', 'from', 'for', 'a', 'an', 'llc', 'inc', 'co', 'corp', 'company',
]);

/** Acronym of the significant words in a business name: "Plumber Down Under" -> "pdu". */
function acronymOf(name) {
  if (!name) return '';
  return String(name).toLowerCase()
    .replace(/[^a-z0-9\s&]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !NAME_STOPWORDS.has(w))
    .map(w => w[0])
    .join('');
}

/** Do two normalized strings share a run of >= 6 chars? */
function sharesLongToken(a, b) {
  if (!a || !b) return false;
  for (let len = Math.min(a.length, b.length); len >= 6; len--) {
    for (let i = 0; i + len <= b.length; i++) {
      if (a.includes(b.slice(i, i + len))) return true;
    }
  }
  return false;
}

function isImplausibleBusinessEmail(email, siteHost, businessName) {
  if (!email || typeof email !== 'string') return true;
  const e = email.trim().toLowerCase();
  const emailDomain = (e.split('@')[1] || '').toLowerCase();
  const localPart = (e.split('@')[0] || '').replace(/[^a-z0-9]/g, '');
  if (!emailDomain) return true;
  if (isBoilerplateAuthorEmail(e)) return true;
  if (FREE_MAIL_DOMAINS.has(emailDomain)) return false; // no domain signal to judge on

  const dom  = registrableName(emailDomain);
  const site = registrableName(siteHost);
  const biz  = String(businessName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!dom) return false;
  if (!site && !biz) return false; // nothing to compare against

  // Related if the email's domain OR its local part echoes either the site
  // domain or the business name. Owners routinely hold a second domain
  // ("Adept Plumbing" on austin-plumber.com) or sign from a personal-ISP
  // address whose local part names the business (edpumpsnmore@…).
  for (const candidate of [dom, localPart]) {
    for (const ref of [site, biz]) {
      if (!candidate || !ref) continue;
      if (candidate === ref || candidate.includes(ref) || ref.includes(candidate)) return false;
      if (sharesLongToken(candidate, ref)) return false;
    }
  }

  // Abbreviated own-domain: "aphinc.net" for Affordable Plumbing & Heat,
  // "pduhome.net" for The Plumber from Down Under. Require >= 3 letters so
  // two-word names don't match half the internet.
  const acro = acronymOf(businessName);
  if (acro.length >= 3 && dom.startsWith(acro)) return false;

  return true;
}

// Business-name markers of a NON-contractor (supply/distribution/retail), plus
// specific national chains seen in real scrapes. Conservative on purpose — better
// to let a borderline contractor through than to wrongly drop a real prospect.
const NON_PROSPECT_PATTERNS = [
  /\b(wholesale|distributor|distribution|showroom)\b/i,
  /\bhome depot\b|\blowe'?s\b|\bmenards\b/i,
  /\bsupply\s*(co\.?|company|inc\.?)?\s*$/i,            // ends in "Supply" / "Supply Co" / "Supply Company"
  /\bferguson\b|\bwinsupply\b|\bwinnelson\b|\bhajoca\b|\bmorrison supply\b|\bmoore supply\b|\byoung tile\b/i,
];

function isNonProspectBusiness(name) {
  if (!name || typeof name !== 'string') return false;
  return NON_PROSPECT_PATTERNS.some(re => re.test(name));
}

module.exports = {
  isPlaceholderEmail, isNonProspectBusiness, isBoilerplateAuthorEmail,
  isImplausibleBusinessEmail, PLACEHOLDER_EMAIL_NEEDLES,
  BOILERPLATE_AUTHOR_NEEDLES, FREE_MAIL_DOMAINS,
};
