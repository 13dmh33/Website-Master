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

module.exports = { isPlaceholderEmail, isNonProspectBusiness, PLACEHOLDER_EMAIL_NEEDLES };
