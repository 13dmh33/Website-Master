// adzuna.js — keyword + location search across the Adzuna aggregator.
//
// Endpoint (needs free app_id + app_key):
//   https://api.adzuna.com/v1/api/jobs/us/search/1?...
// We fetch recent-first (`sort_by=date`) and bound age server-side
// (`max_days_old`) to cut noise and API spend before anything reaches scoring.
// Real posted date comes from `created`.

import { getJson, htmlToText } from '../lib/http.js';
import { config, has } from '../lib/config.js';

// Pull one (query, location) combination. `where` may be empty for nationwide.
export async function pullAdzunaQuery(query, where, { maxDaysOld = 21, resultsPerPage = 50 } = {}) {
  if (!has.adzuna()) return [];
  const params = new URLSearchParams({
    app_id: config.adzuna.appId,
    app_key: config.adzuna.appKey,
    results_per_page: String(resultsPerPage),
    what: query,
    sort_by: 'date',
    max_days_old: String(maxDaysOld),
    'content-type': 'application/json',
  });
  if (where) params.set('where', where);
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`;
  const data = await getJson(url);
  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((r) => {
    const location = r.location?.display_name || '';
    return {
      source: 'adzuna',
      company: r.company?.display_name || 'Unknown',
      title: r.title || '',
      location,
      remote: /remote/i.test(location) || /remote/i.test(r.title || ''),
      url: r.redirect_url || '',
      // Adzuna's own stable ad id, distinct from redirect_url (a click-through
      // tracking link that can carry a per-request session token and differ
      // between pulls of the same posting). dedup.js's jobId() prefers this
      // when present so the same real job keeps a stable identity across runs
      // — without it, a re-pulled posting looks "new" every time, defeating
      // the "nothing repeats in a digest" guarantee and the score cache.
      externalId: r.id != null ? `adzuna:${r.id}` : null,
      description: htmlToText(r.description || ''),
      postedAt: r.created || null,
    };
  });
}

// Pull every (query x location) combination from preferences. Locations default
// to a single nationwide search when none are configured.
export async function pullAdzuna(prefs, { maxDaysOld = 21 } = {}) {
  if (!has.adzuna()) return [];
  const queries = prefs.adzuna_query.length ? prefs.adzuna_query : [];
  const locations = prefs.location.length ? prefs.location : [''];
  const out = [];
  for (const q of queries) {
    for (const loc of locations) {
      // "Remote" is a keyword, not an Adzuna `where` value — search nationwide.
      const where = /remote/i.test(loc) ? '' : loc;
      try {
        const batch = await pullAdzunaQuery(q, where, { maxDaysOld });
        out.push(...batch);
      } catch {
        // One bad query should not sink the whole pull.
      }
    }
  }
  return out;
}
