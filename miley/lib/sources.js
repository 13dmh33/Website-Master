'use strict';

// Live source intelligence for Miley (Techs4Tatas) — ZERO API cost.
//
// Sibling of molly/lib/sources.js, repointed at this brand's two beats:
//   • women in the skilled trades
//   • breast cancer awareness / research
//
// Pulls fresh RSS headlines from the curated news_sources in
// inspiration-sources.json (those that publish a feed), keyword-filters them
// to stay on-brand, and hands the Researcher a short watchlist of paraphrasable
// ANGLES. It never copies article text — headlines are inspiration only; the
// Generator rewrites everything in Riley's voice (copyright rule).
//
// Fails silently on any network problem (the container has restricted egress,
// and feeds move/die) — a dead feed just yields nothing and the pipeline falls
// back to the static evergreen_themes + verified data_hooks. No key required.

const https = require('https');

// RSS endpoints by beat. All free, no API key. Edit/extend freely — anything
// that fails or 404s is dropped silently, so a wrong URL never breaks a run.
// Broad feeds (NPR/CNBC) are keyword-filtered below so only on-topic items pass.
const FEEDS = {
  women_in_trades: [
    'https://www.dol.gov/rss/releases.xml',                 // DOL (Women's Bureau lives here)
    'https://blog.bluebeam.com/feed/',                      // Bluebeam 'Built' — construction articles
    'https://www.bls.gov/feed/bls_latest.rss',              // BLS latest releases (employment/wages)
    'https://feeds.npr.org/1001/rss.xml',                   // NPR news (filtered)
    'https://www.cnbc.com/id/10000115/device/rss/rss.html', // CNBC jobs (filtered)
  ],
  breast_cancer: [
    'https://www.nationalbreastcancer.org/blog/feed/',      // NBCF blog
    'https://www.bcrf.org/blog/feed/',                      // Breast Cancer Research Foundation
    'https://www.breastcancer.org/about-us/news/feed',      // breastcancer.org news
  ],
};

// Keyword gates. Items from broad feeds (and a light sanity check on niche
// feeds) must mention something on-beat to be kept.
const KEYWORDS = {
  women_in_trades: [
    'women', 'woman', 'tradeswom', 'female', 'apprentic', 'construction',
    'electric', 'plumb', 'carpenter', 'welder', 'hvac', 'skilled trade',
    'workforce', 'NAWIC', 'jobsite',
  ],
  breast_cancer: [
    'breast cancer', 'mammogram', 'screening', 'early detection', 'oncology',
    'tumor', 'survivor', 'pink', 'awareness', 'metastatic',
  ],
};

// Fetch one RSS URL → array of headline strings. Always resolves (never throws).
function fetchRss(url) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 6000);
    try {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        // follow one redirect if present
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timeout);
          return resolve(fetchRss(res.headers.location));
        }
        if (res.statusCode !== 200) { clearTimeout(timeout); res.resume(); return resolve([]); }
        let xml = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { xml += chunk; });
        res.on('end', () => { clearTimeout(timeout); resolve(parseRssHeadlines(xml)); });
      });
      req.on('error', () => { clearTimeout(timeout); resolve([]); });
      req.setTimeout(5000, () => { req.destroy(); clearTimeout(timeout); resolve([]); });
    } catch {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function titleFrom(block) {
  const m = /<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is.exec(block);
  if (!m) return null;
  const t = decodeEntities(m[1].trim());
  return (t.length > 15 && !/\b(feed|rss)\b/i.test(t)) ? t : null;
}

// Pull item/entry titles out of RSS or Atom XML — handles CDATA + entities.
// Targets <item>/<entry> blocks specifically so the channel/feed title is
// never mistaken for a headline.
function parseRssHeadlines(xml) {
  if (!xml || xml.length < 50) return [];
  const titles = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = titleFrom(m[0]);
    if (t) titles.push(t);
    if (titles.length >= 12) break;
  }
  return titles;
}

function matchesBeat(headline, beat) {
  const h = headline.toLowerCase();
  return (KEYWORDS[beat] || []).some(k => h.includes(k.toLowerCase()));
}

// Fetch + filter headlines for one beat. Returns up to `limit` on-topic items.
async function fetchBeat(beat, limit = 5) {
  const feeds = FEEDS[beat] || [];
  if (!feeds.length) return [];
  const batches = await Promise.all(feeds.map(url => fetchRss(url).catch(() => [])));
  const seen = new Set();
  const kept = [];
  for (const headline of batches.flat()) {
    const key = headline.toLowerCase();
    if (seen.has(key)) continue;
    if (!matchesBeat(headline, beat)) continue;
    seen.add(key);
    kept.push(headline);
    if (kept.length >= limit) break;
  }
  return kept;
}

// Top-level: fetch fresh headlines for both beats. Returns
// { women_in_trades: [...], breast_cancer: [...], fetchedAt } — empty arrays
// on any failure (offline, restricted egress, dead feeds). Never throws.
async function fetchLiveHeadlines({ perBeat = 4 } = {}) {
  const [women, cancer] = await Promise.all([
    fetchBeat('women_in_trades', perBeat).catch(() => []),
    fetchBeat('breast_cancer', perBeat).catch(() => []),
  ]);
  return {
    women_in_trades: women,
    breast_cancer:   cancer,
    fetchedAt:       new Date().toISOString(),
  };
}

module.exports = {
  fetchLiveHeadlines,
  fetchRss,
  parseRssHeadlines,
  FEEDS,
  KEYWORDS,
};
