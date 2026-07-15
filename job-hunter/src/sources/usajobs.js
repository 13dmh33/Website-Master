// usajobs.js — optional federal source (USAJobs API).
//
// Endpoint (free key; requires your registered email in the User-Agent):
//   https://data.usajobs.gov/api/search?Keyword=...&DatePosted=...
// Headers: Host, User-Agent: <your email>, Authorization-Key: <api key>.
// Real posted date comes from `PublicationStartDate`. `DatePosted` bounds age
// server-side (whole days, max 60).

import { getJson, htmlToText } from '../lib/http.js';
import { config, has } from '../lib/config.js';

export async function pullUsajobs(prefs, { maxDaysOld = 21 } = {}) {
  if (!has.usajobs()) return [];
  const queries = prefs.adzuna_query.length ? prefs.adzuna_query : prefs.title;
  if (!queries.length) return [];
  const datePosted = Math.min(60, Math.max(1, Math.round(maxDaysOld)));
  const headers = {
    Host: 'data.usajobs.gov',
    'User-Agent': config.usajobs.email,
    'Authorization-Key': config.usajobs.apiKey,
  };
  const out = [];
  for (const keyword of queries) {
    const params = new URLSearchParams({
      Keyword: keyword,
      DatePosted: String(datePosted),
      ResultsPerPage: '50',
    });
    const url = `https://data.usajobs.gov/api/search?${params.toString()}`;
    try {
      const data = await getJson(url, { headers });
      const items = data.SearchResult?.SearchResultItems || [];
      for (const item of items) {
        const d = item.MatchedObjectDescriptor || {};
        const location = d.PositionLocationDisplay || '';
        const summary =
          d.UserArea?.Details?.JobSummary || d.QualificationSummary || '';
        out.push({
          source: 'usajobs',
          company: d.OrganizationName || 'Federal government',
          title: d.PositionTitle || '',
          location,
          remote: /remote|telework/i.test(location) || /remote|telework/i.test(summary),
          url: d.PositionURI || '',
          description: htmlToText(summary),
          postedAt: d.PublicationStartDate || null,
        });
      }
    } catch {
      // Skip a failed federal query; the rest of the pipeline continues.
    }
  }
  return out;
}
