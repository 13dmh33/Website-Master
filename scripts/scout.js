#!/usr/bin/env node
/**
 * Scout — Google Maps lead finder via Outscraper
 *
 * Two modes, one codebase:
 *   --mode no-website  (default) — finds contractors with no real website.
 *   --mode has-website           — finds established contractors who DO have
 *                                   a real website + email, captures site_url,
 *                                   emits auditor-ready CSV for /audit, and feeds
 *                                   leads with an email into the pitcher pipeline
 *                                   (mirrored to leads/, queued in state.json).
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
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --mode has-website --csv --force
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --mode has-website --min-reviews 3 --min-rating 3.5 --force
 *                                   (has-website mode only — loosen if a market returns 0 qualifying leads)
 *
 * Reads:  config/scout-config.json  (budget + settings, shared cap across modes)
 *         .env.local                (OUTSCRAPER_API_KEY)
 *         leads/*.json              (no-website pre-dedup; also cross-checked by has-website)
 *         leads-web/*.json          (has-website pre-dedup)
 * Writes: leads/{city}-{trade}-{date}-{run}.json              (no-website mode; also mirrors
 *                                                               has-website's auditor-ready/email leads)
 *         leads-web/{city}-{trade}-{date}-{run}.json           (has-website mode)
 *         leads-web/{city}-{trade}-{date}-{run}.csv             (has-website mode, auditor-ready)
 *         leads-web/needs-email-{city}-{trade}-{date}-{run}.csv (has-website mode, manual lookup queue)
 *         reports/scout-{trade}-{date}.csv  (if --csv, no-website mode)
 *         state.json                (both modes — has-website's auditor-ready/email leads are
 *                                     queued with status 'scouted' just like no-website leads)
 *         config/scout-config.json
 *         logs/{date}.log
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { writeLog }         = require('./logger');
const { recordOutscraper } = require('./cost-tracker');
const { slugify, normalizeDomain } = require('./lib/scout-shared');
const { filterAndFormatNoWebsite, exportToCsv } = require('./lib/scout-no-website');
const { filterAndFormatHasWebsite, exportAuditorCsv, exportNeedsEmailCsv } = require('./lib/scout-has-website');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROOT          = path.join(__dirname, '..');
const CONFIG_PATH   = path.join(ROOT, 'config', 'scout-config.json');
const STATE_PATH    = path.join(ROOT, 'state.json');
const LEADS_DIR     = path.join(ROOT, 'leads');
const LEADS_WEB_DIR = path.join(ROOT, 'leads-web');
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
const minReviews = parseInt(get('--min-reviews') || '10', 10);  // has-website mode only
const minRating  = parseFloat(get('--min-rating') || '4.0');    // has-website mode only
const isDryRun  = hasFlag('--dry-run');
const isMulti   = hasFlag('--multi');
const exportCsv = hasFlag('--csv');
const suggestTrade = get('--suggest');                      // --suggest hvac → show top 5 cities and exit
const mode      = (get('--mode') || 'no-website').toLowerCase();

if (mode !== 'no-website' && mode !== 'has-website') {
  console.error(`--mode must be "no-website" or "has-website" (got "${mode}")`);
  process.exit(1);
}
const isHasWebsiteMode = mode === 'has-website';

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
  console.error('       Add --mode has-website to find contractors who already have a site');
  console.error('       Add --suggest [trade]  to see top 5 markets before picking a city');
  console.error('       Add --budget 0.25 to hard-cap this run at $0.25');
  console.error('       Add --target 50 to auto-calculate limit for ~50 qualifying leads');
  console.error('       Add --min-score 5 to only keep hot leads (gap_score or fit_score depending on mode)');
  console.error('       Add --dry-run to preview without spending');
  console.error('       Add --csv to also export to a CSV report');
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
      total_raw_has_website:        0,
      total_qualifying_has_website: 0,
      last_run:           null,
      auto_run:           false,
      default_limit:      30
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Additive defaults for has-website history — never touches existing no-website fields
  if (config.total_raw_has_website === undefined)        config.total_raw_has_website = 0;
  if (config.total_qualifying_has_website === undefined) config.total_qualifying_has_website = 0;
  return config;
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
  // Mode-aware: has-website and no-website track separate qualify-rate history
  // so one mode's runs never skew the other mode's --target math.
  if (targetArg > 0) {
    const rawCount       = isHasWebsiteMode ? config.total_raw_has_website        : config.total_raw;
    const qualifyingCount = isHasWebsiteMode ? config.total_qualifying_has_website : config.total_qualifying;
    const qualifyRate = (rawCount && qualifyingCount)
      ? qualifyingCount / rawCount
      : DEFAULT_QUALIFY_RATE;
    const calcLimit = Math.ceil(targetArg / qualifyRate);
    const capped    = isMulti ? Math.ceil(calcLimit / (TRADE_SYNONYMS[trade]?.length || 1)) : calcLimit;
    console.log(`  --target ${targetArg} qualifying leads → limit ${capped} (qual rate ${(qualifyRate * 100).toFixed(0)}% from ${mode} history)`);
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
  // Same Outscraper spend, shared cap — but qualify-rate history is tracked
  // per mode so --target stays accurate for each mode independently.
  if (isHasWebsiteMode) {
    config.total_raw_has_website        = (config.total_raw_has_website        || 0) + rawCount;
    config.total_qualifying_has_website = (config.total_qualifying_has_website || 0) + qualifyingCount;
  } else {
    config.total_raw        = (config.total_raw        || 0) + rawCount;
    config.total_qualifying = (config.total_qualifying || 0) + qualifyingCount;
  }
  config.last_run = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  recordOutscraper(rawCount, config.cost_per_result);
  const effectiveCpp = qualifyingCount > 0 ? cost / qualifyingCount : null;
  return { cost, effectiveCpp };
}

// ── PRE-DEDUP: load known place_ids from existing lead files ──────────────────

function loadKnownIdsFromDir(dir) {
  const known = new Set();
  if (!fs.existsSync(dir)) return known;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const l of leads) {
        if (l.place_id) known.add(l.place_id);
        if (l.lead_id)  known.add(l.lead_id);
      }
    } catch { /* skip malformed files */ }
  }
  return known;
}

function loadKnownIds() {
  if (!isHasWebsiteMode) return loadKnownIdsFromDir(LEADS_DIR);
  // has-website mode: dedup against its own output AND no-website's output,
  // so the same contractor is never contacted from both segments.
  const webKnown = loadKnownIdsFromDir(LEADS_WEB_DIR);
  const noWebsiteKnown = loadKnownIdsFromDir(LEADS_DIR);
  return new Set([...webKnown, ...noWebsiteKnown]);
}

// has-website mode only: catches the same business under a different
// place_id (franchise relist, duplicate GBP listing) via normalized
// site_url domain. No-website mode has no website field, so n/a there.
function loadKnownDomainsFromDir(dir) {
  const known = new Set();
  if (!fs.existsSync(dir)) return known;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const l of leads) {
        const domain = normalizeDomain(l.site_url);
        if (domain) known.add(domain);
      }
    } catch { /* skip malformed files */ }
  }
  return known;
}

function loadKnownDomains() {
  return loadKnownDomainsFromDir(LEADS_WEB_DIR);
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

// ── FILENAME — no overwrites on same-day runs ─────────────────────────────────

function buildFilename(cityStr, dir, ext, prefix = '') {
  const dateStr   = new Date().toISOString().split('T')[0];
  const citySlug  = slugify(cityStr);
  const tradeSlug = slugify(trade);
  const base      = `${prefix}${citySlug}-${tradeSlug}-${dateStr}`;

  let index = 1;
  while (fs.existsSync(path.join(dir, `${base}-run${index}.${ext}`))) index++;
  return `${base}-run${index}.${ext}`;
}

// ── STATE UPDATE (no-website mode only — has-website doesn't feed the pitcher queue yet) ──

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

// ── DISCARD-BREAKDOWN LOGGING ─────────────────────────────────────────────────

function logNoWebsiteBreakdown(rawCount, leadsCount, disc, channel) {
  console.log(`  Channel:          ${channel}`);
  console.log(`  Filter breakdown  (${rawCount} raw):`);
  console.log(`    Kept:           ${leadsCount}`);
  console.log(`    Already known:  ${disc.duplicate}  (skipped — saved $$)`);
  console.log(`    Reviews (5-300):${disc.reviews}`);
  console.log(`    Rating <4.0:    ${disc.rating}`);
  console.log(`    Has real site:  ${disc.website}`);
  console.log(`    No phone:       ${disc.noPhone}`);
  if (disc.lowScore > 0)
    console.log(`    Score <${minScore}:       ${disc.lowScore}`);
}

function logHasWebsiteBreakdown(rawCount, leadsCount, needsEmailCount, disc) {
  console.log(`  Filter breakdown  (${rawCount} raw):`);
  console.log(`    Kept (auditor-ready, has email): ${leadsCount}`);
  console.log(`    Needs manual email lookup:       ${needsEmailCount}`);
  console.log(`    Already known:  ${disc.duplicate}  (skipped — saved $$)`);
  console.log(`    Reviews <10:    ${disc.reviews}`);
  console.log(`    Rating <4.0:    ${disc.rating}`);
  console.log(`    No real site:   ${disc.noWebsite}`);
  console.log(`    No phone:       ${disc.noPhone}`);
  if (disc.lowScore > 0)
    console.log(`    Score <${minScore}:       ${disc.lowScore}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nScout ${isDryRun ? '[DRY RUN] ' : ''}— ${trade} in ${city}${isMulti ? ' [multi-query]' : ''} [mode: ${mode}]`);
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

  // Monthly budget check (only applies if no --budget flag) — shared cap across modes
  if (!budgetArg) {
    const capped = checkBudget(config, estimatedCost);
    if (capped !== null) perQueryLimit = Math.max(1, Math.floor(capped / queries.length));
  }

  // Load known place_ids for pre-dedup (saves money on re-scraping same leads)
  const knownIds = loadKnownIds();
  console.log(`  Known leads:      ${knownIds.size} (will skip re-scraping)`);
  console.log(`  Budget:           $${config.spent_this_month.toFixed(2)} / $${config.monthly_cap.toFixed(2)} this month`);
  if (budgetArg) console.log(`  Run cap:          $${budgetArg.toFixed(2)} (--budget)`);
  console.log(`  Queries:          ${queries.length} × ${perQueryLimit} = ~${totalLimit} raw (~$${estimatedCost.toFixed(3)})`);
  console.log(`  Min score:        ${minScore}`);
  if (isHasWebsiteMode) console.log(`  Min reviews/rating: ${minReviews} / ${minRating}`);
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

  if (isHasWebsiteMode) {
    const knownDomains = loadKnownDomains();
    await runHasWebsiteMode(config, flat, knownIds, knownDomains);
  } else {
    await runNoWebsiteMode(config, flat, knownIds);
  }
}

async function runNoWebsiteMode(config, flat, knownIds) {
  const { leads, disc, channel } = filterAndFormatNoWebsite(flat, trade, city, knownIds, minScore);
  logNoWebsiteBreakdown(flat.length, leads.length, disc, channel);

  if (leads.length === 0) {
    console.warn('\nNo qualifying leads found after filtering. Try a different city or trade.');
    process.exit(0);
  }

  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  const filename = buildFilename(city, LEADS_DIR, 'json');
  const outPath   = path.join(LEADS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));

  const { cost: actualCost, effectiveCpp } = updateSpend(config, flat.length, leads.length);
  const newCount = updateState(leads);

  let csvFile = null;
  if (exportCsv) {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    csvFile = `scout-${trade}-${date}.csv`;
    fs.writeFileSync(path.join(REPORTS_DIR, csvFile), exportToCsv(leads));
    console.log(`  CSV exported:     reports/${csvFile}`);
  }

  writeLog('scout', [
    `mode: no-website  city: ${city}  trade: ${trade}${isMulti ? '  [multi]' : ''}`,
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

  console.log('\nTop leads:');
  leads.slice(0, 5).forEach((l, i) => {
    const emailFlag = l.email ? ' ✉' : '';
    console.log(`  ${i + 1}. ${l.business_name} — ${l.review_count} reviews, ${l.rating}★  [score:${l.gap_score}]${emailFlag}`);
  });
}

async function runHasWebsiteMode(config, flat, knownIds, knownDomains) {
  const { leads, needsEmail, disc } = filterAndFormatHasWebsite(flat, trade, city, knownIds, minScore, knownDomains, minReviews, minRating);
  logHasWebsiteBreakdown(flat.length, leads.length, needsEmail.length, disc);

  if (leads.length === 0 && needsEmail.length === 0) {
    console.warn('\nNo qualifying leads found after filtering. Try a different city or trade.');
    process.exit(0);
  }

  if (!fs.existsSync(LEADS_WEB_DIR)) fs.mkdirSync(LEADS_WEB_DIR, { recursive: true });

  const jsonFilename = buildFilename(city, LEADS_WEB_DIR, 'json');
  fs.writeFileSync(path.join(LEADS_WEB_DIR, jsonFilename), JSON.stringify(leads, null, 2));

  let csvFilename = null;
  if (leads.length > 0) {
    csvFilename = buildFilename(city, LEADS_WEB_DIR, 'csv');
    fs.writeFileSync(path.join(LEADS_WEB_DIR, csvFilename), exportAuditorCsv(leads));

    // Auditor-ready leads have a real email — also feed the pitcher pipeline.
    // Mirror into leads/ (same filename, same content) so Diagnoser's leads/*.json
    // scan picks them up, and register them in state.json as 'scouted'.
    if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(LEADS_DIR, jsonFilename), JSON.stringify(leads, null, 2));
    const newToQueue = updateState(leads);
    console.log(`  Queued for pitcher:  ${newToQueue}  (mirrored to leads/${jsonFilename}, state.json)`);
  }

  let needsEmailFilename = null;
  if (needsEmail.length > 0) {
    needsEmailFilename = buildFilename(city, LEADS_WEB_DIR, 'csv', 'needs-email-');
    fs.writeFileSync(path.join(LEADS_WEB_DIR, needsEmailFilename), exportNeedsEmailCsv(needsEmail));
    // Also persist as JSON (same basename) so Enricher can read/update records
    // by lead_id — the CSV alone has no machine-friendly write-back target.
    const needsEmailJsonFilename = needsEmailFilename.replace(/\.csv$/, '.json');
    fs.writeFileSync(path.join(LEADS_WEB_DIR, needsEmailJsonFilename), JSON.stringify(needsEmail, null, 2));
  }

  const qualifyingTotal = leads.length + needsEmail.length;
  const { cost: actualCost, effectiveCpp } = updateSpend(config, flat.length, qualifyingTotal);

  writeLog('scout', [
    `mode: has-website  city: ${city}  trade: ${trade}${isMulti ? '  [multi]' : ''}`,
    `raw: ${flat.length}  auditor-ready: ${leads.length}  needs-email: ${needsEmail.length}`,
    `cost: $${actualCost.toFixed(4)}  effective: ${effectiveCpp ? '$' + effectiveCpp.toFixed(4) + '/lead' : 'n/a'}  monthly: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`,
    `file: leads-web/${jsonFilename}`
  ]);

  console.log('\n─'.repeat(50));
  console.log(`Done.`);
  console.log(`  Auditor-ready leads: ${leads.length}  (of ${flat.length} raw)`);
  console.log(`  Needs manual email:  ${needsEmail.length}`);
  console.log(`  Cost this run:       $${actualCost.toFixed(4)}`);
  if (effectiveCpp)
    console.log(`  Cost per lead:       $${effectiveCpp.toFixed(4)}`);
  console.log(`  Monthly spend:       $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log(`  Saved to:            leads-web/${jsonFilename}`);
  if (csvFilename)        console.log(`  Auditor CSV:         leads-web/${csvFilename}  (feeds /audit/input/leads.csv)`);
  if (needsEmailFilename) console.log(`  Needs-email CSV:     leads-web/${needsEmailFilename}  (manual lookup)`);
  console.log('─'.repeat(50));

  if (leads.length > 0) {
    console.log('\nTop auditor-ready leads:');
    leads.slice(0, 5).forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.business_name} — ${l.review_count} reviews, ${l.rating}★  [fit:${l.fit_score}]  ${l.site_url}`);
    });
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
