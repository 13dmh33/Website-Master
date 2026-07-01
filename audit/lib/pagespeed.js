// Google PageSpeed Insights — load speed, Core Web Vitals, mobile-friendliness.
// Isolated behind a fetcher param so tests can mock the HTTP call without network access.

const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export async function fetchPageSpeed(url, apiKey, fetchImpl = fetch) {
  if (!apiKey) {
    return { available: false, reason: 'no PAGESPEED_API_KEY configured' };
  }

  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: 'mobile',
    category: 'performance'
  });

  try {
    const res = await fetchImpl(`${PAGESPEED_ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      return { available: false, reason: `PageSpeed API returned ${res.status}` };
    }
    const data = await res.json();
    return parsePageSpeedResponse(data);
  } catch (err) {
    return { available: false, reason: `PageSpeed fetch failed: ${err.message}` };
  }
}

export function parsePageSpeedResponse(data) {
  const lighthouse = data?.lighthouseResult;
  const performanceScore = lighthouse?.categories?.performance?.score;
  const audits = lighthouse?.audits || {};
  const lcp = audits['largest-contentful-paint']?.numericValue ?? null;
  const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
  const isMobileFriendly = audits['viewport']?.score === 1;

  if (performanceScore === undefined) {
    return { available: false, reason: 'PageSpeed response missing performance score' };
  }

  return {
    available: true,
    performance_score: Math.round(performanceScore * 100),
    largest_contentful_paint_ms: lcp,
    cumulative_layout_shift: cls,
    is_mobile_friendly: isMobileFriendly,
    is_slow: Math.round(performanceScore * 100) < 50
  };
}
