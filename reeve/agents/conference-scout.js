'use strict';

// conference-scout.js — weekly CFP discovery agent
//
// Runs Monday 7am MT (after researcher.js in the Milly pipeline completes)
// Searches for open calls for speakers via SerpApi
// Saves new opportunities to output/opportunities/{id}.json
// Skips duplicates (same URL already in the pipeline)
//
// Sources searched:
//   - papercall.io (community tech/startup conferences)
//   - sessionize.com (tech conferences)
//   - direct Google search for conference speaker applications
//   - speaking.io, conferencemonster.com via Google
//
// Usage:
//   node agents/conference-scout.js
//   node agents/conference-scout.js --dry-run      (log, don't save)
//   node agents/conference-scout.js --summary      (print pipeline summary only)
//   node agents/conference-scout.js --query-stats  (which queries actually produce results/bookings)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch       = require('node-fetch');
const oppStore     = require('../lib/opportunity-store');
const clientStore  = require('../lib/client-store');
const costTracker  = require('../lib/cost-tracker');

const isDryRun     = process.argv.includes('--dry-run');
const isSummary    = process.argv.includes('--summary');
const isQueryStats = process.argv.includes('--query-stats');

// ── SerpApi ───────────────────────────────────────────────────────────────────

async function searchSerpApi(query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      q:       query,
      engine:  'google',
      api_key: key,
      num:     '10',
      tbs:     'qdr:m', // bias toward results indexed in the past month — CFPs are time-sensitive
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { timeout: 10000 });
    if (!res.ok) return [];
    const data = await res.json();
    return data.organic_results || [];
  } catch {
    return [];
  }
}

// ── CFP Extraction ────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Domain → which aggregator this listing came from. Aggregator-sourced CFPs
// are structured and higher-signal than a random blog/news hit about a
// conference, so downstream (pitcher/reporter) can weight them differently.
function sourceTypeFromUrl(url) {
  if (!url) return 'unknown';
  if (/papercall\.io/i.test(url))   return 'papercall';
  if (/sessionize\.com/i.test(url)) return 'sessionize';
  if (/speakerhub\.com/i.test(url)) return 'speakerhub';
  if (/confs\.tech/i.test(url))     return 'confs.tech';
  return 'direct';
}

// Best-effort $ amount extraction. Snippets rarely contain a fee, so this is
// usually null — but when it's there ("$2,500 honorarium"), pitcher.js can
// use it to avoid pitching opportunities below a client's fee floor.
function extractFeeAmount(text) {
  const matches = text.match(/\$[\d,]+(?:\.\d+)?/g);
  if (!matches) return { min: null, max: null, raw: null };
  const nums = matches.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(n => !isNaN(n));
  if (!nums.length) return { min: null, max: null, raw: null };
  return { min: Math.min(...nums), max: Math.max(...nums), raw: matches.join(', ') };
}

// Best-effort organizer email — snippets occasionally include a contact
// address. Usually null; pitcher.js falls back to Dave filling it in by hand.
function extractOrganizerEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// Parse a search result and extract what we know about the conference.
// `clientTopics` is the full (uncapped) set of niche keywords across active
// clients — used in addition to the generic keyword list so niche speakers
// (wellness, DEI, faith, real estate, etc.) actually get tagged, not just
// the handful of generic tech/business words below.
function extractOpportunity(result, { clientTopics = [], query = null } = {}) {
  const text = `${result.title || ''} ${result.snippet || ''}`;
  const url  = result.link || null;

  // Skip non-CFP results
  const isCfp = /call for speakers|submit.*proposal|cfp open|speaker.*application|sessionize|papercall/i.test(text);
  if (!isCfp) return null;

  // Skip listings that explicitly say the CFP is no longer open
  const isClosed = /cfp closed|submissions? closed|no longer accepting|applications? closed|deadline has passed/i.test(text);
  if (isClosed) return null;

  // Try to extract a deadline date (rough heuristic)
  const deadlineMatch = text.match(/deadline[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const rawDeadline   = deadlineMatch ? deadlineMatch[1] : null;
  let cfpDeadline     = null;
  if (rawDeadline) {
    const parsed = new Date(rawDeadline);
    if (!isNaN(parsed)) cfpDeadline = parsed.toISOString().split('T')[0];
  }

  // If we parsed a deadline that's already in the past, this is a stale
  // listing (old blog post, expired sessionize page, etc.) — skip it outright
  // rather than saving it as "open" only to auto-close it on the next run.
  const today = new Date().toISOString().split('T')[0];
  if (cfpDeadline && cfpDeadline < today) return null;

  // Topics: generic keyword list + real client niches (free-text, e.g.
  // "executive presence", "DEI", "wellness") so matching isn't limited to
  // a handful of tech/business words.
  const genericKeywords = ['technology', 'leadership', 'business', 'startup', 'diversity', 'AI', 'health',
    'education', 'marketing', 'finance', 'innovation', 'entrepreneurship', 'women', 'sustainability'];
  const matchedGeneric = genericKeywords.filter(kw => new RegExp(escapeRegex(kw), 'i').test(text));
  const matchedClient  = clientTopics.filter(topic => new RegExp(escapeRegex(topic), 'i').test(text));
  const topics = Array.from(new Set([...matchedClient, ...matchedGeneric]));

  // Infer fee
  const feeAmount = extractFeeAmount(text);
  const feePaid   = feeAmount.min !== null || /paid|honorarium|stipend/i.test(text);
  const feeUnpaid = /volunteer|unpaid|no.*fee|no.*honorari/i.test(text);
  const fee = feePaid ? 'paid' : feeUnpaid ? 'unpaid' : 'unknown';

  const virtual = /virtual|online|remote/i.test(text);

  // Location: try to read an explicit "City, State" mention out of the
  // snippet first; if the snippet doesn't say, fall back to whichever US
  // region this result came from a region-targeted query (see buildQueries) —
  // a result returned for "conference Austin, Texas" is far more likely to
  // be Austin-relevant than not, even if the snippet itself is silent on it.
  const location = extractLocation(text) || (query?.region && !virtual ? query.region : null);

  return {
    conference:      (result.title || '').slice(0, 120),
    url,
    cfpDeadline,
    topics:          topics.slice(0, 8),
    fee,
    feeAmount,
    organizerEmail:  extractOrganizerEmail(text),
    sourceType:      sourceTypeFromUrl(url),
    virtual,
    location,
    source:          url,
    query:           query?.text || query,
    notes:           (result.snippet || '').slice(0, 200),
  };
}

// Matches a US "City, ST" or "City, State" mention in title/snippet text.
function extractLocation(text) {
  const match = text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2}),\s(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|D\.?C\.?)\b/);
  return match ? `${match[1]}, ${match[2]}` : null;
}

// ── Search queries ────────────────────────────────────────────────────────────

// Pull real client niches from output/clients/ so the search isn't limited to
// the generic tech-conference angle. Capped to keep query count (and SerpApi
// spend) bounded regardless of how many clients are active.
function activeClientTopics(maxTopics = 5) {
  return allClientTopics().slice(0, maxTopics);
}

// Full (uncapped) topic set, for extraction-time tagging — tagging is free
// (no extra API call), so unlike the query-building cap above, every client's
// niche should be checked against every result.
function allClientTopics() {
  const clients = clientStore.getActiveClients();
  const topics  = new Set();
  for (const c of clients) {
    for (const t of c.topics || []) topics.add(t);
  }
  return Array.from(topics);
}

const SITES          = ['papercall.io', 'sessionize.com', 'speakerhub.com', 'confs.tech'];
const PHRASE_VARIANTS = ['"call for speakers"', '"speaker submissions"', '"now accepting proposals"', '"apply to speak"'];
const EXCLUDE         = '-jobs -hiring -recap';

// US-only region rotation (see CLAUDE.md "Geographic targeting"). One region
// is picked per run on a deterministic weekly clock so a scheduled run
// naturally cycles through the whole list over ~12 weeks without needing any
// persisted state. Adds 2 queries/run — keep this list's length reasonable
// or the rotation period (and thus per-region coverage frequency) grows.
const US_REGIONS = [
  'Austin, Texas', 'San Francisco, California', 'New York, New York',
  'Seattle, Washington', 'Chicago, Illinois', 'Boston, Massachusetts',
  'Denver, Colorado', 'Atlanta, Georgia', 'Washington, D.C.',
  'Los Angeles, California', 'Portland, Oregon', 'Nashville, Tennessee',
];

function currentRegion() {
  const weekIndex = Math.floor(Date.now() / (7 * 86400000));
  return US_REGIONS[weekIndex % US_REGIONS.length];
}

// Budget math: ~19-24 queries/run at $0.015/search ≈ $0.36/run, ~$1.44/mo at
// a weekly cadence — well inside the $5/mo cap in config/scout-config.json,
// so the per-query budget check in main() is the real backstop, not this count.
function buildQueries() {
  const now      = new Date();
  const month    = now.toLocaleString('en-US', { month: 'long' });
  const year     = now.getFullYear();
  const nextYear = year + 1;
  const region   = currentRegion();

  const queries = [];
  const push = (text, opts = {}) => queries.push({ text, region: null, ...opts });

  // Aggregator-specific — current year and next year (CFPs for next year's
  // event often open mid-this-year, so a year-only filter misses them).
  for (const site of SITES) {
    push(`site:${site} "call for speakers" open ${year} ${EXCLUDE}`);
    push(`site:${site} "call for speakers" ${nextYear} ${EXCLUDE}`);
  }

  // Generic phrasing — rotated wording since real listings don't all say
  // "call for speakers" verbatim ("submissions open", "apply to speak", etc.)
  push(`"call for speakers" conference ${month} ${year} deadline ${EXCLUDE}`);
  push(`speaking opportunity submit proposal conference ${year} ${EXCLUDE}`);
  push(`keynote speaker application conference open ${year} ${EXCLUDE}`);
  push(`"now accepting proposals" conference speaker ${year} ${EXCLUDE}`);
  push(`"apply to speak" conference ${nextYear} ${EXCLUDE}`);

  // US region targeting — one region/run, rotated weekly. These queries put
  // the city/state directly in the search text (Google's organic search has
  // no location-radius filter; SerpApi's location/gl/hl params only bias
  // results toward the *searcher's* locale, not the conference's, so they
  // don't help here — see CLAUDE.md for why this approach was chosen instead).
  push(`"call for speakers" conference "${region}" ${year} ${EXCLUDE}`, { region });
  push(`speaker submissions conference "${region}" ${nextYear} ${EXCLUDE}`, { region });

  // Client-topic queries — capped (see activeClientTopics), phrasing rotated
  // per topic so the same niche isn't always searched with the same wording.
  activeClientTopics().forEach((topic, i) => {
    const phrase = PHRASE_VARIANTS[i % PHRASE_VARIANTS.length];
    push(`${phrase} "${topic}" conference ${year} ${EXCLUDE}`);
  });

  return queries;
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary() {
  const closed = oppStore.closeExpiredOpportunities();
  const all    = oppStore.getAllOpportunities();
  const open   = oppStore.getOpenOpportunities();
  const today  = new Date().toISOString().split('T')[0];
  const urgent = open.filter(o => o.cfpDeadline && o.cfpDeadline <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
  const { config: budget } = costTracker.checkBudget();

  console.log('\n═══ Reeve Conference Pipeline ═══');
  console.log(`Total indexed:  ${all.length}`);
  console.log(`Open (active):  ${open.length}`);
  console.log(`Deadline <7d:   ${urgent.length}`);
  if (closed.length > 0) console.log(`Auto-closed (deadline passed): ${closed.length}`);
  console.log(`SerpApi spend:  $${budget.spent_this_month.toFixed(2)} / $${budget.monthly_cap.toFixed(2)} this month`);
  console.log('');

  if (urgent.length > 0) {
    console.log('⚠️  Urgent — deadline within 7 days:');
    for (const o of urgent) {
      console.log(`  • ${o.conference} — deadline ${o.cfpDeadline}`);
      if (o.url) console.log(`    ${o.url}`);
    }
    console.log('');
  }

  if (open.length > 0) {
    console.log('Open opportunities:');
    for (const o of open) {
      const deadline = o.cfpDeadline || 'no deadline listed';
      const pitched  = o.pitches?.length ? `  [${o.pitches.length} pitch(es) sent]` : '';
      console.log(`  • ${o.conference} — ${deadline}${pitched}`);
    }
  } else {
    console.log('No open opportunities. Run without --summary to scout for new ones.');
  }

  console.log('═'.repeat(35));
}

// Aggregates outcomes by the query that found each opportunity, so weak
// queries can be dropped from buildQueries() and productive ones expanded —
// closes the loop between query design and actual pitcher/closer outcomes.
function printQueryStats() {
  const all = oppStore.getAllOpportunities();
  const byQuery = new Map();

  for (const o of all) {
    const key = o.query || '(unknown — scouted before query tracking was added)';
    if (!byQuery.has(key)) byQuery.set(key, { found: 0, pitched: 0, accepted: 0 });
    const stats = byQuery.get(key);
    stats.found++;
    if (o.pitches?.length) stats.pitched++;
    if (o.pitches?.some(p => p.response === 'accepted')) stats.accepted++;
  }

  console.log('\n═══ Reeve Scout — Query Effectiveness ═══');
  if (!byQuery.size) {
    console.log('No opportunities indexed yet.');
    return;
  }

  const sorted = Array.from(byQuery.entries()).sort((a, b) => b[1].accepted - a[1].accepted || b[1].found - a[1].found);
  for (const [query, stats] of sorted) {
    console.log(`\n  ${query}`);
    console.log(`    found: ${stats.found} | pitched: ${stats.pitched} | accepted: ${stats.accepted}`);
  }
  console.log('\n' + '═'.repeat(40));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isQueryStats) {
    printQueryStats();
    return;
  }

  if (isSummary) {
    printSummary();
    return;
  }

  console.log(`\nConference Scout starting${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  if (!process.env.SERPAPI_KEY) {
    console.log('SERPAPI_KEY not configured — scout cannot run without live search.');
    console.log('Add SERPAPI_KEY to .env and retry.');
    process.exit(1);
  }

  const closedExpired = oppStore.closeExpiredOpportunities();
  if (closedExpired.length > 0) {
    console.log(`Auto-closed ${closedExpired.length} opportunity(ies) past their CFP deadline.`);
  }

  let budgetConfig = costTracker.loadConfig();
  const queries      = buildQueries();
  const clientTopics = allClientTopics();
  let found = 0, saved = 0, skipped = 0, budgetExhausted = false;

  for (const query of queries) {
    const { ok, remaining } = costTracker.checkBudget();
    if (!ok) {
      console.log(`\nSerpApi monthly cap reached ($${budgetConfig.monthly_cap.toFixed(2)}, $${remaining.toFixed(3)} remaining) — stopping search.`);
      budgetExhausted = true;
      break;
    }

    console.log(`\nSearching: ${query.text}`);
    const results = await searchSerpApi(query.text);
    budgetConfig = costTracker.recordSearch(budgetConfig);

    for (const result of results) {
      found++;
      const opp = extractOpportunity(result, { clientTopics, query });
      if (!opp) { skipped++; continue; }

      // Skip duplicates — same URL already in pipeline
      if (opp.url && oppStore.isDuplicate(opp.url)) {
        console.log(`  dup: ${opp.conference.slice(0, 60)}`);
        skipped++;
        continue;
      }

      console.log(`  new: ${opp.conference.slice(0, 70)}`);
      if (opp.cfpDeadline) console.log(`       deadline: ${opp.cfpDeadline}`);

      if (!isDryRun) {
        oppStore.createOpportunity(opp);
        saved++;
      } else {
        saved++; // count in dry run for reporting
      }
    }
  }

  const open = oppStore.getOpenOpportunities();

  if (!isDryRun) {
    budgetConfig = costTracker.recordRunSummary(budgetConfig, { found, saved });
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Scout complete.`);
  console.log(`  Results scanned:  ${found}`);
  console.log(`  New opportunities: ${isDryRun ? `${saved} (dry run)` : saved}`);
  console.log(`  Skipped (dup/non-CFP): ${skipped}`);
  console.log(`  Pipeline total (open): ${open.length}`);
  console.log(`  SerpApi spend: $${budgetConfig.spent_this_month.toFixed(3)} / $${budgetConfig.monthly_cap.toFixed(2)} this month${budgetExhausted ? ' (cap reached — search stopped early)' : ''}`);
  console.log('─'.repeat(50));

  // Surface urgent deadlines
  const today  = new Date().toISOString().split('T')[0];
  const urgent = open.filter(o => o.cfpDeadline && o.cfpDeadline <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
  if (urgent.length > 0) {
    console.log(`\n⚠️  ${urgent.length} opportunity(ies) with deadline within 7 days:`);
    for (const o of urgent) {
      console.log(`  • ${o.conference} — deadline ${o.cfpDeadline}`);
    }
  }
}

main().catch(err => {
  console.error('Scout failed:', err.message);
  process.exit(1);
});
