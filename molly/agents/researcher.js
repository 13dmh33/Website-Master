'use strict';

// researcher — weekly research agent for Molly
// runs Monday 6am MT via GitHub Actions (or manually)
// hybrid strategy: tries live search first, falls back to evergreen posts
// saves brief to output/briefs/brief-[YYYY-MM-DD].json

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch    = require('node-fetch');
const store    = require('../lib/store');
const glossary = require('../lib/glossary');
const sources  = require('../lib/sources');

const TRADES = ['plumbing', 'hvac', 'electrical', 'handyman'];

function weekStartDate() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  return mon.toISOString().split('T')[0];
}

async function searchSerpApi(query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({ q: query, engine: 'google', api_key: key, num: '5' });
    const res    = await fetch(`https://serpapi.com/search.json?${params}`, { timeout: 10000 });
    if (!res.ok) return null;
    const data   = await res.json();
    return (data.organic_results || []).map(r => ({
      title:   r.title   || '',
      snippet: r.snippet || '',
      link:    r.link    || '',
    }));
  } catch {
    return null;
  }
}

// build content angles from live search results, enriched with trade intelligence
function buildAnglesFromSearch(allResults, trade = 'hvac', tradeContext = null) {
  const niches  = ['education', 'results', 'product', 'journey'];
  const angles  = [];
  const now     = new Date();
  const month   = now.toLocaleString('en-US', { month: 'long' });
  const year    = now.getFullYear();

  const nicheMap = {
    education: allResults[0] || [],
    results:   allResults[1] || [],
    product:   allResults[2] || [],
    journey:   allResults[3] || [],
  };

  const glossarySeeds = {
    education: glossary.getAngleSeedTerms('education', 1),
    results:   glossary.getAngleSeedTerms('results', 1),
    product:   glossary.getAngleSeedTerms('product', 1),
  };

  // pull trade-specific hooks and pain points if available
  const tradeHooks      = tradeContext ? sources.getRandomHooks(trade, 3)      : [];
  const tradePainPoints = tradeContext ? sources.getRandomPainPoints(trade, 3) : [];

  for (const [niche, results] of Object.entries(nicheMap)) {
    const topResult  = results[0];
    if (!topResult) continue;
    const termSeed   = glossarySeeds[niche]?.[0];
    const tradeHook  = tradeHooks.shift() || null;
    const painPoint  = tradePainPoints.shift() || 'losing jobs to competitors with better online presence';

    angles.push({
      id:              `angle-${angles.length + 1}`,
      niche,
      trade,
      angle:           topResult.title.slice(0, 120),
      hook:            tradeHook || termSeed?.content_angle || `Most contractors don't know this about ${niche === 'education' ? 'getting found online' : niche === 'results' ? 'how websites drive revenue' : niche === 'product' ? 'what a great contractor site includes' : 'how agency-built sites work'}.`,
      painPoint,
      dataPoint:       topResult.snippet ? topResult.snippet.slice(0, 120) : null,
      suggestedFormat: niche === 'education' ? 'carousel' : niche === 'product' ? 'trevo_found' : niche === 'results' ? 'caption' : 'reel',
      source:          topResult.link,
      glossarySeed:    termSeed ? { term: termSeed.term, angle: termSeed.content_angle } : null,
      tradeContext:    tradeContext ? tradeContext.slice(0, 400) : null,
    });
  }

  // always include a trevo_found angle to showcase a demo
  const demoTrades = ['plumbing', 'HVAC', 'electrical', 'handyman', 'roofing'];
  const demoTrade  = demoTrades[Math.floor(Math.random() * demoTrades.length)];
  angles.push({
    id:              `angle-${angles.length + 1}`,
    niche:           'product',
    trade:           demoTrade,
    angle:           `New ${demoTrade} demo site — ${month} ${year}`,
    hook:            `Trevo just built a new ${demoTrade} demo. Here\'s what\'s inside.`,
    painPoint:       'contractors not seeing what a real site looks like for their trade',
    dataPoint:       null,
    suggestedFormat: 'trevo_found',
    source:          null,
  });

  return angles;
}

function buildAnglesFromEvergreen(evergreenPosts) {
  return evergreenPosts.map((p, i) => ({
    id:              `angle-${i + 1}`,
    niche:           p.niche,
    angle:           p.hook,
    hook:            p.hook,
    painPoint:       'losing jobs to competitors with better websites',
    dataPoint:       null,
    suggestedFormat: p.format,
    evergreenId:     p.id,
    prewrittenContent: { hook: p.hook, body: p.body, hashtags: p.hashtags },
  }));
}

async function main() {
  const weekOf = weekStartDate();
  // rotate through trades each week so content varies
  const tradeIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % TRADES.length;
  const weekTrade  = TRADES[tradeIndex];
  console.log(`Molly research starting for week of ${weekOf} (trade focus: ${weekTrade}).`);

  let researchMode = 'live';
  let angles       = [];
  const now        = new Date();
  const month      = now.toLocaleString('en-US', { month: 'long' });
  const year       = now.getFullYear();

  // fetch trade-specific context from sources intelligence (zero cost — static + optional RSS)
  let tradeContext = null;
  try {
    tradeContext = await sources.getWeeklyResearchContext(weekTrade);
    console.log(`Trade intelligence loaded for ${weekTrade}.`);
  } catch {
    // non-fatal — just log and continue
    console.log('Trade intelligence unavailable — continuing without it.');
  }

  if (process.env.SERPAPI_KEY) {
    console.log('Running live search via SerpApi...');
    try {
      const queries = [
        `${weekTrade} contractor website marketing tips ${year}`,
        `home service ${weekTrade} contractor online presence ${month} ${year}`,
        `contractor website features that convert ${year}`,
        `local SEO for plumbers electricians HVAC ${year}`,
      ];

      const allResults = [];
      for (const q of queries) {
        const results = await searchSerpApi(q);
        allResults.push(results || []);
      }

      const totalResults = allResults.reduce((sum, r) => sum + r.length, 0);
      if (totalResults > 0) {
        angles       = buildAnglesFromSearch(allResults, weekTrade, tradeContext);
        researchMode = 'live';
        console.log(`Live research complete. ${totalResults} results found, ${angles.length} angles built.`);
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

  if (researchMode === 'evergreen') {
    const evergreenPosts = store.getUnusedEvergreen(4);
    if (!evergreenPosts.length) {
      console.log('No evergreen posts available. Run node scripts/generate-evergreen.js first.');
      process.exit(1);
    }
    angles = buildAnglesFromEvergreen(evergreenPosts);
    store.markEvergreenUsed(evergreenPosts.map(p => p.id));
    console.log(`Using evergreen fallback — ${angles.length} angles loaded.`);
  }

  const brief = {
    weekOf,
    generatedAt:  new Date().toISOString(),
    researchMode,
    weekTrade,
    angles:       angles.slice(0, 4),
  };

  const filePath = store.saveBrief(brief);
  console.log(`Research complete. Mode: ${researchMode}. Angles: ${brief.angles.length}.`);
  console.log(`Brief saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Researcher failed: ${err.message}`);
  process.exit(1);
});
