// greenhouse.js — pull postings from a company's public Greenhouse job board.
//
// Endpoint (no auth):
//   https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
// `content=true` includes the (HTML) job description. Real posted date comes
// from `updated_at`.
//
// Normalized shape (shared by every source):
//   { source, company, title, location, remote, url, description, postedAt }
// The caller (scout) assigns the stable id and firstSeenAt.

import { getJson, htmlToText } from '../lib/http.js';

export async function pullGreenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`;
  const data = await getJson(url);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs.map((j) => {
    const location = j.location?.name || '';
    return {
      source: 'greenhouse',
      company: slug,
      title: j.title || '',
      location,
      remote: /remote/i.test(location) || /remote/i.test(j.title || ''),
      url: j.absolute_url || '',
      description: htmlToText(j.content || ''),
      postedAt: j.updated_at || j.first_published || null,
    };
  });
}
