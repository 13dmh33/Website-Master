// ashby.js — pull postings from a company's public Ashby job board.
//
// Endpoint (no auth):
//   https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
// Real posted date comes from `publishedAt` (falling back to `publishedDate`).
// Description is available as `descriptionPlain` (HTML fallback).

import { getJson, htmlToText } from '../lib/http.js';

export async function pullAshby(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  const data = await getJson(url);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs.map((j) => {
    const location = j.location || j.locationName || '';
    return {
      source: 'ashby',
      company: slug,
      title: j.title || '',
      location,
      remote: Boolean(j.isRemote) || /remote/i.test(location),
      // Two distinct upstream URLs can exist — jobUrl (Ashby's own listing
      // page) and applyUrl (the actual apply link, sometimes off-Ashby).
      // Previously collapsed with `||`, silently discarding whichever wasn't
      // first — both are now kept so the digest can show both when they
      // differ (see CHANGE_REQUEST.md, Change 1).
      url: j.jobUrl || j.applyUrl || '',
      applyUrl: j.applyUrl && j.applyUrl !== j.jobUrl ? j.applyUrl : null,
      description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''),
      postedAt: j.publishedAt || j.publishedDate || null,
    };
  });
}
