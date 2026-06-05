'use strict';

// Source intelligence for Molly — zero API cost
// Reads the 200-source curated database to seed content angles
// Static archetypes give Molly trade expertise; optional RSS adds weekly freshness
// Falls back gracefully on any network failure

const fs   = require('fs');
const path = require('path');
const http  = require('https');

const SOURCES_PATH = path.join(__dirname, '..', 'templates', 'sources.json');

// Trade-specific content archetypes learned from monitoring the 200-source database.
// These are the recurring pain points, hooks, and angles that resonate in each trade community.
const ARCHETYPES = {
  hvac: {
    painPoints: [
      'losing spring AC tune-up season to competitors with better Google presence',
      'emergency calls at 2am going to whoever shows up first on search',
      'refrigerant regulation changes confusing homeowners — they search, they find someone else',
      'techs are booked but phone stops ringing after peak season ends',
      'callbacks happen but homeowner can\'t find the original company — no website to look up',
    ],
    hooks: [
      "It's 97 degrees. Someone's AC broke. They searched Google. Did they find you?",
      'Your competitor just got 3 emergency calls this weekend. You missed all of them.',
      'Spring tune-up season just started. Your competitor has a website. You don\'t.',
      'R-22 is gone. R-410A is phasing out. Homeowners are confused and searching for answers.',
      'One emergency call at 2am pays for a website. If they can find you.',
    ],
    contentAngles: [
      'emergency preparedness — emergency button placement, 24/7 visibility',
      'seasonal demand — how to capture spring AC and fall heating surges',
      'refrigerant regulation education for homeowners (EPA 608 phase-out)',
      'energy efficiency — SEER ratings, rebates, what homeowners are searching',
      'indoor air quality — post-COVID homeowner concern driving search volume',
    ],
    trendingTopics: [
      'R-410A phase-out 2025-2026',
      'heat pump adoption — IRA tax credits',
      'smart thermostat integration',
      'mini-split installation demand surge',
      'HVAC workforce shortage — contractor value goes up',
    ]
  },

  plumbing: {
    painPoints: [
      'pipe burst at 2am — homeowner searches, finds competitor who has a 24/7 button',
      'water heater replacement leads going to big box stores because plumber has no site',
      'drain cleaning jobs — first page on Google takes all the repeat calls',
      'sewer inspection leads go to whoever comes up first — inspection is a trust sale',
      'slow referral month — no website means no organic leads to fill the gap',
    ],
    hooks: [
      'A pipe burst at 2am. Someone searched plumber near me. Was it you?',
      'Homeowners don\'t wait for referrals when water is on the floor.',
      '150 Google reviews and no website. That\'s leaving 30% of your leads on the table.',
      'Your neighbor called a plumber last week. It wasn\'t you. Here\'s why.',
      'Water heater replacement: $800-$2,000 job. Goes to whoever ranks on page one.',
    ],
    contentAngles: [
      'emergency response — 24/7 service, tap-to-call above the fold',
      'water heater replacement — most common high-ticket first job from Google',
      'drain cleaning — high volume, easy entry point, repeat customer driver',
      'sewer inspection — homeowner education on what to look for and who to trust',
      'trenchless technology — homeowners search this, most plumbers don\'t explain it',
    ],
    trendingTopics: [
      'tankless water heater demand (energy rebates)',
      'backflow prevention regulations',
      'PEX vs copper — homeowner confusion = opportunity',
      'water quality concerns driving filter installs',
      'sewer line inspection before home purchase',
    ]
  },

  electrical: {
    painPoints: [
      'EV charger installs going to whoever comes up first when someone googles "EV charger installer near me"',
      'panel upgrades — homeowner gets 3 quotes, picks whoever has best reviews online',
      'code violations found during inspection — homeowners search fast, call whoever they find',
      'smart home wiring jobs going to competitors with more visible web presence',
      'referrals drying up — no website means no discovery from anyone new',
    ],
    hooks: [
      'EV charger demand is up 40% this year. Is your name showing up when homeowners search?',
      'Panel upgrade. 3 quotes. Homeowner picks whoever has the best reviews online. Was that you?',
      'Someone in your city searched electrician near me today. They hired your competitor.',
      'NEC code updated. Homeowners need inspections. Are they finding you or someone else?',
      'One EV charger install can pay for a year of website hosting.',
    ],
    contentAngles: [
      'EV charger installation boom — #1 electrical search term growth this year',
      'panel upgrade demand — aging housing stock, 200A requirements',
      'NEC code updates — homeowner education drives inbound leads',
      'smart home wiring — demand growing faster than qualified electricians',
      'solar + battery storage — homeowners searching for trusted electrical contractors',
    ],
    trendingTopics: [
      'EV charger Level 2 home installation',
      'panel upgrade for EV + solar load',
      'NEC 2023 arc fault requirements',
      'whole-home generator installation',
      'solar interconnection and battery storage',
    ]
  },

  handyman: {
    painPoints: [
      'weekend punch list jobs going to TaskRabbit because handyman has no Google presence',
      'repeat customers can\'t find the number — no website, no way to look it up',
      'losing assembly/install jobs to Angi leads who outrank on search',
      'word-of-mouth plateau — referrals maxed out, no way to reach new customers',
      'professional credibility gap — no license/insurance visible = homeowner hesitates',
    ],
    hooks: [
      'A homeowner searched for a handyman last Saturday. They found TaskRabbit instead of you.',
      'Your business card is in a junk drawer. Your website is available 24/7.',
      'The handyman with 90 Google reviews and a website is getting 5x the calls you are.',
      'Word of mouth hits a ceiling. A website breaks through it.',
      'Angi takes 20-35% of the job. Your own website takes 0%.',
    ],
    contentAngles: [
      'competing with Angi/TaskRabbit — why a real website wins long-term',
      'seasonal demand — spring punch lists, pre-holiday fixes, pre-winter weatherproofing',
      'repeat customer retention — the #1 reason to have a site is so they can find you again',
      'professional credibility — license/insurance proof builds trust before the call',
      'scope expansion — a website lets you list every service, not just what you said at the door',
    ],
    trendingTopics: [
      'aging-in-place modifications (grab bars, ramps, wider doorways)',
      'smart home device installation — growing demand from non-DIY homeowners',
      'small deck and fence repairs — spring demand spike',
      'home office setup installations — remote work permanent demand',
      'pre-listing repairs for real estate market',
    ]
  }
};

// RSS feed URLs for sources that reliably publish RSS (subset of the 200-source database)
// All free — no API key required
const RSS_FEEDS = {
  hvac: [
    'https://www.achrnews.com/rss/articles',
    'https://www.contractingbusiness.com/rss/all',
    'https://www.hvacinsider.com/feed',
  ],
  plumbing: [
    'https://www.pmmag.com/rss/all',
    'https://www.contractormag.com/rss/all',
  ],
  electrical: [
    'https://www.ecmweb.com/rss/all',
    'https://www.ecmag.com/rss',
  ],
  business: [
    'https://www.getjobber.com/academy/feed',
    'https://www.servicetitan.com/blog/feed',
  ],
};

function loadSources() {
  if (!fs.existsSync(SOURCES_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Get sources filtered by trade and optional category
function getSourcesByTrade(trade, category = null) {
  const data = loadSources();
  if (!data || !data.sources) return [];
  return data.sources.filter(s =>
    (s.trades.includes(trade) || s.trades.includes('multi')) &&
    (!category || s.categories.includes(category))
  );
}

// Get the archetype context for a given trade — pain points, hooks, angles, trends
function getArchetype(trade) {
  return ARCHETYPES[trade] || ARCHETYPES.handyman;
}

// Fetch RSS headlines from a URL — returns array of headline strings
// Fails silently — returns [] on any error
function fetchRss(url) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve([]), 6000);

    try {
      const req = http.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let xml = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { xml += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          resolve(parseRssHeadlines(xml));
        });
      });
      req.on('error', () => { clearTimeout(timeout); resolve([]); });
      req.setTimeout(5000, () => { req.destroy(); clearTimeout(timeout); resolve([]); });
    } catch {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

// Extract titles from RSS XML — works for both CDATA and plain title formats
function parseRssHeadlines(xml) {
  if (!xml || xml.length < 50) return [];
  const titles = [];
  const re = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gis;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (t.length > 15 && !t.toLowerCase().includes(' feed') && !t.toLowerCase().includes(' rss')) {
      titles.push(t);
    }
  }
  // skip first match (usually the feed name itself)
  return titles.slice(1, 7);
}

// Fetch live angles from RSS — tries the first 2 feeds for a trade, merges results
// Returns [] immediately if no network or feeds fail
async function fetchLiveAngles(trade) {
  const feeds = RSS_FEEDS[trade] || [];
  if (!feeds.length) return [];

  const results = await Promise.all(feeds.slice(0, 2).map(url => fetchRss(url)));
  return results.flat().slice(0, 8);
}

// Build a formatted context string to inject into Claude prompts
// Includes: archetype pain points, hooks, trend topics, and optional live headlines
function buildResearcherContext(trade, liveHeadlines = []) {
  const arch = getArchetype(trade);
  const sources = getSourcesByTrade(trade, 'humor').slice(0, 3);

  const lines = [
    `Trade expertise context for ${trade}:`,
    '',
    'Contractor pain points (what they talk about in forums like Reddit r/HVAC, HVAC-Talk):',
    ...arch.painPoints.slice(0, 3).map(p => `  - ${p}`),
    '',
    'Hooks that stop ${trade} contractors from scrolling (from monitoring top trade IG/YT accounts):',
    ...arch.hooks.slice(0, 3).map(h => `  - ${h}`),
    '',
    'Trending topics in the ${trade} community right now:',
    ...arch.trendingTopics.slice(0, 3).map(t => `  - ${t}`),
  ];

  if (liveHeadlines.length) {
    lines.push('', 'This week\'s industry headlines (use as angle inspiration, do not quote directly):');
    liveHeadlines.slice(0, 5).forEach(h => lines.push(`  - ${h}`));
  }

  lines.push(
    '',
    'Content inspiration sources (what these communities care about):',
    ...sources.map(s => `  - ${s.name}: ${s.notes}`),
    '',
    'Note: Use these as inspiration for authentic contractor-facing content. Never name specific sources in posts.'
  );

  return lines.join('\n');
}

// Full weekly context for the researcher — combines static + optional live data
async function getWeeklyResearchContext(trade) {
  const liveHeadlines = await fetchLiveAngles(trade).catch(() => []);
  return buildResearcherContext(trade, liveHeadlines);
}

// Get 3 random pain points for a given trade (for prompts that need short context)
function getRandomPainPoints(trade, count = 3) {
  const arch = getArchetype(trade);
  const shuffled = [...arch.painPoints].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Get 2 random hooks for a given trade
function getRandomHooks(trade, count = 2) {
  const arch = getArchetype(trade);
  const shuffled = [...arch.hooks].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

module.exports = {
  getSourcesByTrade,
  getArchetype,
  fetchLiveAngles,
  buildResearcherContext,
  getWeeklyResearchContext,
  getRandomPainPoints,
  getRandomHooks,
  ARCHETYPES,
};
