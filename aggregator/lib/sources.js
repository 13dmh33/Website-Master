/**
 * aggregator/lib/sources — query/seed definitions for the 4 aggregator lanes.
 * Pure data + fetch helpers. No writes, no state mutation.
 */

const https = require('https');

const LANES = ['license_prep', 'bonding_insurance', 'sbdc_score', 'trade_school'];

// Home-service trades Trevo actually serves later via Nora. HVAC included here
// (program filter only — Trevo never contacts HVAC contractors directly, but
// excluding HVAC *grads* from the trade-school resource lane has no upside).
const TRADE_SCHOOL_DEFAULT_TRADES = ['plumbing', 'electrical', 'hvac', 'roofing'];

// National online license-prep providers — not tied to a single state, so they
// don't fit the per-state Maps query pattern below. Maps/web search still
// needed to find their contact info; this is just the list of org names to
// search for.
const NATIONAL_LICENSE_PREP_PROVIDERS = [
  'PSI Exams contractor licensing',
  'Contractor Training Center',
  'PROCTORU contractor exam prep',
  'Builders License Training Institute',
  '1099 contractor license school'
];

function mapsQueriesForLane(lane, { state, city, trade } = {}) {
  switch (lane) {
    case 'license_prep':
      if (!state) return [];
      return [
        `contractor license course ${state}`,
        `contractor exam prep ${state}`
      ];
    case 'bonding_insurance':
      if (!city) return [];
      return [
        `contractor bond agency ${city}`,
        `contractor insurance agency ${city}`
      ];
    case 'trade_school':
      if (!state) return [];
      return [
        `trade school ${state}`,
        `vocational school ${state}`,
        ...(trade ? [`${trade} training ${state}`] : [])
      ];
    case 'sbdc_score':
      // Primary source is the structured seed fetchers below — Maps is the
      // fallback when a state/region has no seed match.
      if (!city) return [];
      return [`SBDC small business development center ${city}`, `SCORE chapter ${city}`];
    default:
      return [];
  }
}

function httpsGetText(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGetText(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out fetching ${url}`)));
    req.on('error', reject);
  });
}

// Best-effort structured seed fetch. Live directory HTML is not stable enough
// to lock a parser to — if it fails (network blocked, markup changed), the
// caller falls back to mapsQueriesForLane('sbdc_score', ...) per-metro.
async function fetchSbdcSeeds() {
  try {
    await httpsGetText('https://americassbdc.org/find-your-sbdc/');
    // Directory is JS-rendered; a real parser needs a headless browser or
    // their lookup API. Left as a stub seed (empty) so the Maps fallback
    // carries sbdc_score until this is wired to a stable data source.
    return [];
  } catch {
    return [];
  }
}

async function fetchScoreSeeds() {
  try {
    await httpsGetText('https://www.score.org/find-mentor');
    return [];
  } catch {
    return [];
  }
}

module.exports = {
  LANES,
  TRADE_SCHOOL_DEFAULT_TRADES,
  NATIONAL_LICENSE_PREP_PROVIDERS,
  mapsQueriesForLane,
  fetchSbdcSeeds,
  fetchScoreSeeds
};
