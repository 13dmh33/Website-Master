/**
 * aggregator/lib/track-link — per-org tracking link assignment.
 *
 * v1 has no per-org cal.com link infra, so every org gets the same booking
 * destination with a UTM signature that uniquely identifies it. That UTM
 * signature is the referral-attribution mechanism (and, for license_prep,
 * doubles as the affiliate-tracking code — no separate payment infra needed).
 */

const { slugify } = require('../../scripts/lib/scout-shared');

function baseBookingUrl() {
  return process.env.CALCOM_LINK || 'https://cal.com/david-hettinger-g8qbdk/30min';
}

function buildTrackLink(org) {
  const slug = slugify(`${org.source_type}-${org.org_name}-${org.city || ''}`);
  const params = new URLSearchParams({
    utm_source: 'aggregator',
    utm_medium: 'email',
    utm_campaign: org.source_type,
    utm_content: slug
  });
  return `${baseBookingUrl()}?${params.toString()}`;
}

module.exports = { baseBookingUrl, buildTrackLink };
