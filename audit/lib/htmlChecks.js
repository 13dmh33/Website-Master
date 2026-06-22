// Deterministic, free/near-free checks run directly against a site's HTML + response metadata.
// Each check is a pure function of (html, url, headers) so it can be unit-tested against fixtures
// without any network access.

const BUILDER_SUBDOMAIN_PATTERNS = [
  { platform: 'wix', regex: /\.wixsite\.com/i },
  { platform: 'godaddy', regex: /\.godaddysites\.com/i },
  { platform: 'squarespace', regex: /\.squarespace\.com/i },
  { platform: 'weebly', regex: /\.weeblysite\.com/i }
];

const PLATFORM_HTML_SIGNATURES = [
  { platform: 'wix', regex: /wix\.com|wixstatic\.com|wix-code/i },
  { platform: 'squarespace', regex: /squarespace\.com|static1\.squarespace/i },
  { platform: 'godaddy', regex: /godaddysites\.com|godaddy\.com\/website-builder/i },
  { platform: 'weebly', regex: /weebly\.com|weeblycloud\.com/i },
  { platform: 'wordpress', regex: /wp-content|wp-includes|wordpress/i }
];

export function getDomainType(url) {
  const isBuilderSubdomain = BUILDER_SUBDOMAIN_PATTERNS.some(({ regex }) => regex.test(url));
  return {
    domain_type: isBuilderSubdomain ? 'builder_subdomain' : 'custom_domain',
    builder_subdomain_platform: isBuilderSubdomain
      ? BUILDER_SUBDOMAIN_PATTERNS.find(({ regex }) => regex.test(url)).platform
      : null
  };
}

export function detectPlatform(html, url) {
  const fromSubdomain = getDomainType(url).builder_subdomain_platform;
  if (fromSubdomain) return fromSubdomain;

  for (const { platform, regex } of PLATFORM_HTML_SIGNATURES) {
    if (regex.test(html)) return platform;
  }
  return 'custom';
}

export function checkSsl(url) {
  return { ssl_valid: url.trim().toLowerCase().startsWith('https://') };
}

export function checkTapToCall(html) {
  return { has_tap_to_call: /href\s*=\s*["']tel:/i.test(html) };
}

export function checkContactForm(html) {
  return { has_contact_form: /<form[\s>]/i.test(html) };
}

export function checkStructuredData(html) {
  const hasJsonLd = /<script[^>]+type\s*=\s*["']application\/ld\+json["']/i.test(html);
  const hasLocalBusinessSchema = hasJsonLd && /LocalBusiness|"@type"\s*:\s*"[^"]*Plumb|Electric|Contractor/i.test(html);
  return { has_structured_data: hasJsonLd, has_local_business_schema: !!hasLocalBusinessSchema };
}

const CURRENT_YEAR = new Date().getFullYear();
const STALE_YEAR_THRESHOLD = 3;

export function checkStaleness(html) {
  const copyrightMatches = [...html.matchAll(/(?:copyright|©|&copy;)\s*(\d{4})/gi)];
  const years = copyrightMatches.map((m) => parseInt(m[1], 10)).filter((y) => y > 1990 && y <= CURRENT_YEAR + 1);
  if (years.length === 0) {
    return { footer_copyright_year: null, stale_signal: false, stale_reason: null };
  }
  const mostRecentYear = Math.max(...years);
  const ageInYears = CURRENT_YEAR - mostRecentYear;
  return {
    footer_copyright_year: mostRecentYear,
    stale_signal: ageInYears >= STALE_YEAR_THRESHOLD,
    stale_reason: ageInYears >= STALE_YEAR_THRESHOLD
      ? `footer copyright year is ${mostRecentYear}, ${ageInYears} years old`
      : null
  };
}

// Runs every deterministic check and merges results into one flat object.
export function runDeterministicChecks({ html, url }) {
  return {
    ...getDomainType(url),
    platform: detectPlatform(html, url),
    ...checkSsl(url),
    ...checkTapToCall(html),
    ...checkContactForm(html),
    ...checkStructuredData(html),
    ...checkStaleness(html)
  };
}
