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
      url: j.hostedUrl || j.applyUrl || '',
      description: j.descriptionPlain || htmlToText(j.description || ''),
      postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
    };
  });
}
