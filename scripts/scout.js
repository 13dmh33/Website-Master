#!/usr/bin/env node
/**
 * Scout — Google Maps lead finder via Outscraper
 *
 * Usage:
 *   node scripts/scout.js --suggest hvac            ← show top 5 markets for a trade, then exit
 *   node scripts/scout.js --suggest                 ← show top 5 across all trades
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --force
 *   node scripts/scout.js --city "Austin, TX" --trade hvac --limit 20 --force
 *   node scripts/scout.js --city "Denver, CO" --trade electrician --multi --force
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --budget 0.25 --force
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --target 50 --force
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --min-score 5 --force
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --csv --force
 *   node scripts/scout.js --dry-run --city "Denver, CO" --trade plumber
 *
 * Reads:  config/scout-config.json  (budget + settings)
 *         .env.local                (OUTSCRAPER_API_KEY)
 *         leads/*.json              (for pre-dedup of known place_ids)
 * Writes: leads/{city}-{trade}-{date}-{run}.json
 *         reports/scout-{date}.csv  (if --csv)
 *         state.json
 *         config/scout-config.json
 *         logs/{date}.log
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { writeLog }         = require('./logger');
const { recordOutscraper } = require('./cost-tracker');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROOT          = path.join(__dirname, '..');
const CONFIG_PATH   = path.join(ROOT, 'config', 'scout-config.json');
const STATE_PATH    = path.join(ROOT, 'state.json');
const LEADS_DIR     = path.join(ROOT, 'leads');
const REPORTS_DIR   = path.join(ROOT, 'reports');

// Historical qualify rate — updated from real runs; used by --target
const DEFAULT_QUALIFY_RATE = 0.30;

// ── TRADE SYNONYMS (--multi mode) ─────────────────────────────────────────────
// HVAC excluded — owner works for HVAC manufacturer, no conflict-of-interest targeting
const TRADE_SYNONYMS = {
  plumber:     ['plumber', 'plumbing company', 'drain cleaning service'],
  electrician: ['electrician', 'electrical contractor', 'electrical repair'],
  roofer:      ['roofing contractor', 'roof repair', 'roofer'],
  handyman:    ['handyman', 'home repair service', 'handyman service']
};

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const get      = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (flag) => args.includes(flag);

const city      = get('--city');
const trade     = get('--trade');
const limitArg  = parseInt(get('--limit') || '30', 10);
const budgetArg = parseFloat(get('--budget') || '0');      // --budget 0.25 caps this run
const targetArg = parseInt(get('--target') || '0', 10);    // --target 50 → auto-calc limit
const minScore  = parseInt(get('--min-score') || '3', 10); // --min-score 5 → only keep hot leads
const isDryRun  = hasFlag('--dry-run');
const isMulti   = hasFlag('--multi');
const exportCsv = hasFlag('--csv');
const suggestTrade = get('--suggest');                      // --suggest hvac → show top 5 cities and exit

// ── MARKET SUGGEST MODE ───────────────────────────────────────────────────────
// show top 5 markets for a trade and optionally exit (no --city needed)
if (hasFlag('--suggest') || suggestTrade !== null) {
  const MARKET_DATA_PATH = path.join(ROOT, 'config', 'market-data.json');
  if (!fs.existsSync(MARKET_DATA_PATH)) {
    console.error('config/market-data.json not found — run node scripts/market-audit.js first.');
    if (!city || !trade) process.exit(1);
  } else {
    const tradeFilter  = (suggestTrade || trade || '').toLowerCase();
    const allMarkets   = JSON.parse(fs.readFileSync(MARKET_DATA_PATH, 'utf8')).markets;
    const filtered     = tradeFilter
      ? allMarkets.filter(m => m.trades.includes(tradeFilter))
      : allMarkets;
    const ranked       = [...filtered].sort((a, b) => b.demand_score - a.demand_score);
    const tradeLabel   = tradeFilter ? tradeFilter.toUpperCase() : 'all trades';

    console.log(`\n${'─'.repeat(65)}`);
    console.log(`  TOP MARKETS for ${tradeLabel} (by contractor website demand)`);
    console.log(`${'─'.repeat(65)}`);
    ranked.slice(0, 5).forEach((m, i) => {
      const score = m.demand_score.toFixed(2);
      console.log(`  ${i + 1}. ${m.city}, ${m.state}  [score: ${score}]`);
      console.log(`     ${m.notes}`);
    });
    console.log(`${'─'.repeat(65)}`);
    const top     = ranked[0];
    const tArg    = tradeFilter || 'plumbing';
    const tradeMap = { plumbing: 'plumber', electrical: 'electrician', roofing: 'roofer', handyman: 'handyman' };
    const scoutTrade = tradeMap[tArg] || tArg;
    console.log(`  To scrape the top market:`);
    console.log(`  node scripts/scout.js --city "${top.city}, ${top.state}" --trade ${scoutTrade} --budget 0.25 --force`);
    console.log();

    // if no --city/--trade provided, just show suggestions and exit
    if (!city || !trade) process.exit(0);
  }
}

if (!city || !trade) {
  console.error('Usage: node scout.js --city "Denver, CO" --trade plumber [--multi] [--force]');
  console.error('       Add --suggest [trade]  to see top 5 markets before picking a city');
  console.error('       Add --budget 0.25 to hard-cap this run at $0.25');
  console.error('       Add --target 50 to auto-calculate limit for ~50 qualifying leads');
  console.error('       Add --min-score 5 to only keep gap_score >= 5 leads');
  console.error('       Add --dry-run to preview without spending');
  console.error('       Add --csv to also export to reports/scout-{date}.csv');
  process.exit(1);
}

const VALID_TRADES = ['plumber', 'electrician', 'roofer', 'handyman'];
if (trade.toLowerCase() === 'hvac') {
  console.error('HVAC is not a target trade. Focus on: plumber, electrician, roofer, handyman.');
  process.exit(1);
}
if (!VALID_TRADES.includes(trade.toLowerCase())) {
  console.error(`Trade must be one of: ${VALID_TRADES.join(', ')}`);
  process.exit(1);
}

// ── CONFIG HELPERS ────────────────────────────────────────────────────────────

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      monthly_cap:        10.00,
      cost_per_result:    0.001,
      current_month:      currentMonth(),
      spent_this_month:   0.00,
      total_runs:         0,
      total_raw:          0,
      total_qualifying:   0,
      last_run:           null,
      auto_run:           false,
      default_limit:      30
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function checkAutoRun(config) {
  if (hasFlag('--force') || isDryRun) return;
  if (!config.auto_run) {
    console.log('Scout is in manual mode (auto_run = false).');
    console.log('Run with --force to execute now, or set auto_run = true in config/scout-config.json.');
    process.exit(0);
  }
}

// ── BUDGET CHECK ──────────────────────────────────────────────────────────────

function resolveLimit(config) {
  const costPerResult = config.cost_per_result || 0.001;

  // --budget flag: hard cap this run regardless of monthly cap
  if (budgetArg > 0) {
    const maxFromBudget = Math.floor(budgetArg / costPerResult);
    console.log(`  --budget $${budgetArg.toFixed(2)} → max ${maxFromBudget} raw results`);
    return maxFromBudget;
  }

  // --target flag: auto-calculate limit to get N qualifying leads
  if (targetArg > 0) {
    const qualifyRate = (config.total_raw && config.total_qualifying)
      ? config.total_qualifying / config.total_raw
      : DEFAULT_QUALIFY_RATE;
    const calcLimit = Math.ceil(targetArg / qualifyRate);
    const capped    = isMulti ? Math.ceil(calcLimit / (TRADE_SYNONYMS[trade]?.length || 1)) : calcLimit;
    console.log(`  --target ${targetArg} qualifying leads → limit ${capped} (qual rate ${(qualifyRate * 100).toFixed(0)}% from history)`);
    return capped;
  }

  return limitArg;
}

function checkBudget(config, estimatedCost) {
  if (config.current_month !== currentMonth()) {
    config.current_month    = currentMonth();
    config.spent_this_month = 0;
    console.log('New month detected — spend counter reset to $0.00');
  }

  const remaining = config.monthly_cap - config.spent_this_month;

  if (remaining <= 0) {
    console.error(`BUDGET CAP REACHED: $${config.spent_this_month.toFixed(2)} of $${config.monthly_cap.toFixed(2)} used this month.`);
    process.exit(1);
  }

  if (estimatedCost > remaining) {
    const maxTotal = Math.floor(remaining / config.cost_per_result);
    console.warn(`  Budget warning: $${remaining.toFixed(2)} remaining. Capping at ${maxTotal} total.`);
    return maxTotal;
  }

  return null;
}

function updateSpend(config, rawCount, qualifyingCount) {
  const cost = rawCount * config.cost_per_result;
  config.spent_this_month  = parseFloat((config.spent_this_month + cost).toFixed(4));
  config.total_runs       += 1;
  config.total_raw        = (config.total_raw        || 0) + rawCount;
  config.total_qualifying = (config.total_qualifying || 0) + qualifyingCount;
  config.last_run          = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  recordOutscraper(rawCount, config.cost_per_result);
  const effectiveCpp = qualifyingCount > 0 ? cost / qualifyingCount : null;
  return { cost, effectiveCpp };
}

// ── PRE-DEDUP: load known place_ids from existing lead files ──────────────────

function loadKnownPlaceIds() {
  const known = new Set();
  if (!fs.existsSync(LEADS_DIR)) return known;
  for (const file of fs.readdirSync(LEADS_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8'));
      for (const l of leads) {
        if (l.place_id) known.add(l.place_id);
        if (l.lead_id)  known.add(l.lead_id);
      }
    } catch { /* skip malformed files */ }
  }
  return known;
}

// ── OUTSCRAPER API ────────────────────────────────────────────────────────────

function pollTask(resultsUrl, apiKey) {
  return new Promise((resolve, reject) => {
    const MAX_ATTEMPTS = 90;
    let attempt = 0;
    const parsed_url = new URL(resultsUrl);

    function poll() {
      const options = {
        hostname: parsed_url.hostname,
        path:     parsed_url.pathname + parsed_url.search,
        method:   'GET',
        headers:  { 'X-API-KEY': apiKey }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === 'Success' && parsed.data?.length > 0) {
              console.log(' done');
              return resolve(parsed.data);
            }
            if (parsed.status === 'Failure' || parsed.status === 'Error') {
              return reject(new Error(`Outscraper task failed: ${parsed.status}`));
            }
            attempt++;
            if (attempt >= MAX_ATTEMPTS) {
              return reject(new Error(`Outscraper task timed out after ${MAX_ATTEMPTS * 2}s`));
            }
            process.stdout.write('.');
            setTimeout(poll, 2000);
          } catch (e) {
            reject(new Error(`Failed to parse poll response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    }

    poll();
  });
}

async function callOutscraper(query, limit, apiKey) {
  const params = new URLSearchParams({
    query:    `${query} in ${city}`,
    limit:    String(limit),
    language: 'en',
    region:   'us',
    fields:   'name,email,phone,site,full_address,rating,reviews,place_id,latitude,longitude,subtypes'
  });

  const options = {
    hostname: 'api.app.outscraper.com',
    path:     `/maps/search-v3?${params}`,
    method:   'GET',
    headers:  { 'X-API-KEY': apiKey }
  };

  const raw = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse Outscraper response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  if (raw.status === 'Success' && raw.data?.length > 0) return raw.data;

  if (raw.id && raw.results_location) {
    process.stdout.write(`  Async task (id: ${raw.id}) — polling`);
    return pollTask(raw.results_location, apiKey);
  }

  throw new Error(`Outscraper error: ${JSON.stringify(raw)}`);
}

// ── LEAD SCORING + FILTERING ──────────────────────────────────────────────────

function scoreGap(result) {
  let score = 0;

  // No website → core signal; filter already guarantees this but score it
  if (!result.site || result.site.trim() === '') score += 3;

  // Review sweet spot (visible enough to trust, not dominant market leader)
  const reviews = result.reviews || 0;
  if      (reviews >= 10 && reviews <= 30)  score += 4;
  else if (reviews >= 31 && reviews <= 80)  score += 3;
  else if (reviews >= 81 && reviews <= 150) score += 2;
  else if (reviews > 150)                   score += 1;

  // Rating quality
  const rating = result.rating || 0;
  if      (rating >= 4.8) score += 2;
  else if (rating >= 4.5) score += 1;

  // Email present signals more complete listing (rare for contractors)
  if (result.email && result.email.trim() !== '') score += 1;

  return Math.min(score, 10);
}

function channelForTrade(t) {
  const map = {
    plumber:     'sms',
    hvac:        'sms',
    electrician: 'sms',
    roofer:      'sms',
    handyman:    'ig_dm'
  };
  return map[t.toLowerCase()] || 'sms';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Detect social-media-only "websites" — not a real web presence
function isSocialOnlySite(site) {
  if (!site) return false;
  return /facebook\.com|instagram\.com|yelp\.com\/biz|nextdoor\.com|thumbtack\.com/i.test(site);
}

function filterAndFormat(results, tradeStr, cityStr, knownIds) {
  const channel = channelForTrade(tradeStr);

  let disc = { reviews: 0, rating: 0, website: 0, noPhone: 0, duplicate: 0, lowScore: 0 };
  const leads = [];

  for (const r of results) {
    // Skip already-known leads (pre-dedup from existing files)
    const pid = r.place_id;
    if (pid && knownIds.has(pid)) { disc.duplicate++; continue; }

    if (!r.reviews || r.reviews < 5 || r.reviews > 300) { disc.reviews++; continue; }
    if (!r.rating  || r.rating  < 4.0)                  { disc.rating++;  continue; }
    if (!r.phone   || r.phone.trim() === '')             { disc.noPhone++; continue; }

    // Filter out businesses with a real website (social-only "sites" are not disqualifying)
    const hasSite = r.site && r.site.trim() !== '' && !isSocialOnlySite(r.site);
    if (hasSite) { disc.website++; continue; }

    const gap = scoreGap(r);
    if (gap < minScore) { disc.lowScore++; continue; }

    leads.push({
      lead_id:       r.place_id || `${slugify(r.name)}-${slugify(cityStr)}`,
      business_name: r.name || '',
      trade:         tradeStr,
      city:          cityStr,
      years_on_maps: null,
      review_count:  r.reviews   || 0,
      rating:        r.rating    || 0,
      website:       r.site      || null,
      email:         r.email     ? r.email.trim() : '',
      phone:         r.phone     || '',
      address:       r.full_address || '',
      place_id:      r.place_id  || null,
      subtypes:      Array.isArray(r.subtypes) ? r.subtypes : (r.subtypes ? [r.subtypes] : []),
      latitude:      r.latitude  || null,
      longitude:     r.longitude || null,
      gap_score:     gap,
      channel,
      notes:         '',
      scraped_at:    new Date().toISOString()
    });
  }

  console.log(`  Channel:          ${channel}`);
  console.log(`  Filter breakdown  (${results.length} raw):`);
  console.log(`    Kept:           ${leads.length}`);
  console.log(`    Already known:  ${disc.duplicate}  (skipped — saved $$)`);
  console.log(`    Reviews (5-300):${disc.reviews}`);
  console.log(`    Rating <4.0:    ${disc.rating}`);
  console.log(`    Has real site:  ${disc.website}`);
  console.log(`    No phone:       ${disc.noPhone}`);
  if (disc.lowScore > 0)
    console.log(`    Score <${minScore}:       ${disc.lowScore}`);

  return leads.sort((a, b) => b.gap_score - a.gap_score);
}

// ── CSV EXPORT ────────────────────────────────────────────────────────────────

function exportToCsv(leads) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(REPORTS_DIR, `scout-${trade}-${date}.csv`);
  const header = 'business_name,trade,city,phone,email,review_count,rating,gap_score,channel,address';
  const rows = leads.map(l => [
    `"${l.business_name.replace(/"/g, '""')}"`,
    l.trade, l.city, l.phone, l.email,
    l.review_count, l.rating, l.gap_score, l.channel,
    `"${l.address.replace(/"/g, '""')}"`
  ].join(','));
  fs.writeFileSync(file, [header, ...rows].join('\n'));
  console.log(`  CSV exported:     reports/scout-${trade}-${date}.csv`);
  return file;
}

// ── FILENAME — no overwrites on same-day runs ─────────────────────────────────

function buildFilename(cityStr) {
  const dateStr   = new Date().toISOString().split('T')[0];
  const citySlug  = slugify(cityStr);
  const tradeSlug = slugify(trade);
  const base      = `${citySlug}-${tradeSlug}-${dateStr}`;

  let index = 1;
  while (fs.existsSync(path.join(LEADS_DIR, `${base}-run${index}.json`))) index++;
  return `${base}-run${index}.json`;
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leads) {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const existingIds = new Set([
    ...state.queue.map(l => l.lead_id || l),
    ...state.active.map(l => l.lead_id || l),
    ...state.closed.map(l => l.lead_id || l)
  ]);

  const newLeads = leads.filter(l => !existingIds.has(l.lead_id));
  newLeads.forEach(l => {
    state.queue.push({ lead_id: l.lead_id, status: 'scouted', added_at: new Date().toISOString() });
  });
  state.daily_stats.leads_scouted = (state.daily_stats.leads_scouted || 0) + newLeads.length;
  state.last_run = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return newLeads.length;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nScout ${isDryRun ? '[DRY RUN] ' : ''}— ${trade} in ${city}${isMulti ? ' [multi-query]' : ''}`);
  console.log('─'.repeat(50));

  const config = loadConfig();
  checkAutoRun(config);

  // Resolve limit from --budget or --target or --limit
  let perQueryLimit = resolveLimit(config);

  const queries       = isMulti ? (TRADE_SYNONYMS[trade.toLowerCase()] || [trade]) : [trade];
  const costPerResult = config.cost_per_result || 0.001;

  // For multi, split limit evenly across queries
  if (isMulti) perQueryLimit = Math.max(1, Math.floor(perQueryLimit / queries.length));

  const totalLimit    = perQueryLimit * queries.length;
  const estimatedCost = totalLimit * costPerResult;

  // Monthly budget check (only applies if no --budget flag)
  if (!budgetArg) {
    const capped = checkBudget(config, estimatedCost);
    if (capped !== null) perQueryLimit = Math.max(1, Math.floor(capped / queries.length));
  }

  // Load known place_ids for pre-dedup (saves money on re-scraping same leads)
  const knownIds = loadKnownPlaceIds();
  console.log(`  Known leads:      ${knownIds.size} (will skip re-scraping)`);
  console.log(`  Budget:           $${config.spent_this_month.toFixed(2)} / $${config.monthly_cap.toFixed(2)} this month`);
  if (budgetArg) console.log(`  Run cap:          $${budgetArg.toFixed(2)} (--budget)`);
  console.log(`  Queries:          ${queries.length} × ${perQueryLimit} = ~${totalLimit} raw (~$${estimatedCost.toFixed(3)})`);
  console.log(`  Min gap score:    ${minScore}`);
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN — no API call made. Remove --dry-run to execute.');
    return;
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    console.error('OUTSCRAPER_API_KEY not set in .env.local');
    console.error('Scout must run on Mac where the key is configured.');
    process.exit(1);
  }

  // Fetch all queries, deduplicate by place_id
  const allRaw = [];
  for (const query of queries) {
    if (queries.length > 1) process.stdout.write(`  Query: "${query}" `);
    try {
      const results = await callOutscraper(query, perQueryLimit, apiKey);
      const flat = results.flat ? results.flat() : results;
      if (queries.length > 1) console.log(`(${flat.length} results)`);
      allRaw.push(...flat);
    } catch (err) {
      writeLog('scout', [`WARN: query "${query}" failed — ${err.message}`]);
      console.warn(`  Skipping failed query "${query}": ${err.message}`);
    }
  }

  if (allRaw.length === 0) {
    console.error('All queries failed or returned no results.');
    process.exit(1);
  }

  // Deduplicate by place_id (multi-query overlap)
  const seen = new Set();
  const flat = [];
  for (const r of allRaw) {
    const key = r.place_id || r.name;
    if (!seen.has(key)) { seen.add(key); flat.push(r); }
  }
  if (isMulti) console.log(`\n  Deduped: ${allRaw.length} raw → ${flat.length} unique`);

  const leads = filterAndFormat(flat, trade, city, knownIds);

  if (leads.length === 0) {
    console.warn('\nNo qualifying leads found after filtering. Try a different city or trade.');
    process.exit(0);
  }

  const filename = buildFilename(city);
  const outPath  = path.join(LEADS_DIR, filename);
  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));

  const { cost: actualCost, effectiveCpp } = updateSpend(config, flat.length, leads.length);
  const newCount = updateState(leads);
  if (exportCsv) exportToCsv(leads);

  writeLog('scout', [
    `city: ${city}  trade: ${trade}${isMulti ? '  [multi]' : ''}`,
    `raw: ${flat.length}  qualifying: ${leads.length}  new: ${newCount}`,
    `cost: $${actualCost.toFixed(4)}  effective: ${effectiveCpp ? '$' + effectiveCpp.toFixed(4) + '/lead' : 'n/a'}  monthly: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`,
    `file: leads/${filename}`
  ]);

  // ROI estimate based on historical conversion rate
  const estimatedRevenue = leads.length * 0.05 * 150; // 5% close rate × $100

  console.log('\n─'.repeat(50));
  console.log(`Done.`);
  console.log(`  Qualifying leads: ${leads.length}  (of ${flat.length} raw)`);
  console.log(`  New to pipeline:  ${newCount}`);
  console.log(`  Cost this run:    $${actualCost.toFixed(4)}`);
  if (effectiveCpp)
    console.log(`  Cost per lead:    $${effectiveCpp.toFixed(4)}`);
  console.log(`  Monthly spend:    $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  if (leads.length > 0)
    console.log(`  Est. revenue:     $${estimatedRevenue.toFixed(0)} (5% close × $100)`);
  console.log(`  Saved to:         leads/${filename}`);
  console.log('─'.repeat(50));

  // Show top 5 leads
  console.log('\nTop leads:');
  leads.slice(0, 5).forEach((l, i) => {
    const emailFlag = l.email ? ' ✉' : '';
    console.log(`  ${i + 1}. ${l.business_name} — ${l.review_count} reviews, ${l.rating}★  [score:${l.gap_score}]${emailFlag}`);
  });
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
