'use strict';

// researcher — weekly research agent
// runs Monday 6am MT via GitHub Actions (or manually)
// hybrid strategy: tries live search first, falls back to evergreen posts
// saves brief to /output/briefs/brief-[YYYY-MM-DD].json

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const store  = require('../lib/store');

// get the Monday of the current week as YYYY-MM-DD
function weekStartDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

// search SerpApi for speaking industry angles
async function searchSerpApi(query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  try {
    const params = new URLSearchParams({
      q:       query,
      engine:  'google',
      api_key: key,
      num:     '5',
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { timeout: 10000 });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.organic_results || []).map(r => ({
      title:   r.title || '',
      snippet: r.snippet || '',
      link:    r.link || '',
    }));
  } catch {
    return null;
  }
}

// parse conference deadline mentions from search results
function extractConferences(results) {
  const conferences = [];
  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    // look for common conference/CFP signals
    if (/call for speakers|submit.*proposal|cfp|speaking.*application/i.test(text)) {
      conferences.push({
        name:     r.title.slice(0, 80),
        deadline: null, // deadline parsing would need more sophisticated NLP
        topic:    'varies',
        url:      r.link,
      });
    }
  }
  return conferences.slice(0, 3);
}

// build content angles from live search results
function buildAnglesFromSearch(allResults) {
  const niches = ['booking', 'automation', 'mindset'];
  const angles = [];
  const now    = new Date();
  const month  = now.toLocaleString('en-US', { month: 'long' });
  const year   = now.getFullYear();

  // one angle per niche, pulled from relevant result sets
  const nicheMap = {
    booking:    allResults[0] || [],
    automation: allResults[1] || [],
    mindset:    allResults[2] || [],
  };

  for (const [niche, results] of Object.entries(nicheMap)) {
    const topResult = results[0];
    if (!topResult) continue;

    angles.push({
      id:              `angle-${angles.length + 1}`,
      niche,
      angle:           topResult.title.slice(0, 120),
      hook:            `Most speakers don't know this about ${niche === 'booking' ? 'getting booked' : niche === 'automation' ? 'running their pipeline' : 'showing up on stage'}.`,
      painPoint:       'waiting to be discovered instead of pitching proactively',
      dataPoint:       topResult.snippet ? topResult.snippet.slice(0, 120) : null,
      suggestedFormat: niche === 'booking' ? 'carousel' : niche === 'automation' ? 'reel_script' : 'caption',
      source:          topResult.link,
    });
  }

  // fourth angle — always a "reeve found this" format on booking niche
  angles.push({
    id:              `angle-${angles.length + 1}`,
    niche:           'booking',
    angle:           `Speaking opportunities open for ${month} ${year}`,
    hook:            'Reeve found opportunities this week. Here\'s what\'s open.',
    painPoint:       'not knowing where to look for speaking opportunities',
    dataPoint:       null,
    suggestedFormat: 'reeve_found',
    source:          null,
  });

  return angles;
}

// build angles from evergreen posts (fallback path)
function buildAnglesFromEvergreen(evergreenPosts) {
  const store_module = require('../lib/store');
  return evergreenPosts.map((p, i) => ({
    id:              `angle-${i + 1}`,
    niche:           p.niche,
    angle:           p.hook,
    hook:            p.hook,
    painPoint:       'speaking consistently without a pipeline',
    dataPoint:       null,
    suggestedFormat: p.format,
    evergreenId:     p.id,
    prewrittenContent: { hook: p.hook, body: p.body, hashtags: p.hashtags },
  }));
}

async function main() {
  const weekOf = weekStartDate();
  console.log(`Research starting for week of ${weekOf}.`);

  let researchMode  = 'live';
  let angles        = [];
  let conferences   = [];
  const now         = new Date();
  const month       = now.toLocaleString('en-US', { month: 'long' });
  const year        = now.getFullYear();

  // attempt live research via SerpApi
  if (process.env.SERPAPI_KEY) {
    console.log('Running live search via SerpApi...');
    try {
      const queries = [
        `"call for speakers" site:papercall.io OR site:sessionize.com`,
        `speaking industry news ${month} ${year}`,
        `conference speaker opportunities ${month} ${year}`,
        `public speaking tips trending ${year}`,
      ];

      const allResults = [];
      for (const q of queries) {
        const results = await searchSerpApi(q);
        allResults.push(results || []);
      }

      const totalResults = allResults.reduce((sum, r) => sum + r.length, 0);
      if (totalResults > 0) {
        conferences = extractConferences(allResults[0]);
        angles      = buildAnglesFromSearch(allResults);
        researchMode = 'live';
        console.log(`Live research complete. Found ${totalResults} results, ${conferences.length} conference mentions.`);
      } else {
        throw new Error('No results returned');
      }
    } catch (err) {
      console.log(`Live research failed (${err.message}) — using evergreen fallback.`);
      researchMode = 'evergreen';
    }
  } else {
    console.log('SerpApi not configured — using evergreen fallback.');
    researchMode = 'evergreen';
  }

  // evergreen fallback
  if (researchMode === 'evergreen') {
    const evergreenPosts = store.getUnusedEvergreen(4);
    if (!evergreenPosts.length) {
      console.log('No evergreen posts available. Run node scripts/generate-evergreen.js first.');
      process.exit(1);
    }
    angles = buildAnglesFromEvergreen(evergreenPosts);
    store.markEvergreenUsed(evergreenPosts.map(p => p.id));
    console.log(`Live research failed — using evergreen fallback for week of ${weekOf}.`);
  }

  // build the brief
  const brief = {
    weekOf,
    generatedAt:   new Date().toISOString(),
    researchMode,
    angles:        angles.slice(0, 4),
    conferencesFound: conferences,
  };

  const filePath = store.saveBrief(brief);
  console.log(`Research complete. Mode: ${researchMode}. Angles: ${brief.angles.length}. Conferences found: ${conferences.length}.`);
  console.log(`Brief saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Researcher failed: ${err.message}`);
  process.exit(1);
});
