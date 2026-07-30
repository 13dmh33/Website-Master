// lever.js — pull postings from a company's public Lever board.
//
// Endpoint (no auth):
//   https://api.lever.co/v0/postings/<slug>?mode=json
// Real posted date comes from `createdAt` (epoch ms). Description is available
// as `descriptionPlain`.

import { getJson, htmlToText } from '../lib/http.js';

export async function pullLever(slug) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  const data = await getJson(url);
  const jobs = Array.isArray(data) ? data : [];
  return jobs.map((j) => {
    const location = j.categories?.location || '';
    const workplace = (j.workplaceType || '').toLowerCase();
    return {
      source: 'lever',
      company: slug,
      title: j.text || '',
      location,
      remote: workplace === 'remote' || /remote/i.test(location),
      // Two distinct upstream URLs can exist — hostedUrl (Lever's own listing
      // page) and applyUrl (the apply-form link). Previously collapsed with
      // `||`, silently discarding whichever wasn't first — both are now kept
      // so the digest can show both when they differ (see CHANGE_REQUEST.md,
      // Change 1).
      url: j.hostedUrl || j.applyUrl || '',
      applyUrl: j.applyUrl && j.applyUrl !== j.hostedUrl ? j.applyUrl : null,
      description: j.descriptionPlain || htmlToText(j.description || ''),
      postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
    };
  });
}
