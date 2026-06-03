#!/usr/bin/env node
/**
 * Scout — Google Maps lead finder via Outscraper
 *
 * Usage:
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --force
 *   node scripts/scout.js --city "Austin, TX" --trade hvac --limit 20 --force
 *   node scripts/scout.js --city "Denver, CO" --trade electrician --multi --force
 *
 * Reads:  config/scout-config.json  (budget + settings)
 *         .env.local                (OUTSCRAPER_API_KEY)
 * Writes: leads/{city}-{date}-{run}.json
 *         state.json (appends new lead IDs)
 *         config/scout-config.json (updates spend)
 *         logs/{date}.log
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { writeLog }         = require('./logger');
const { recordOutscraper } = require('./cost-tracker');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'scout-config.json');
const STATE_PATH  = path.join(ROOT, 'state.json');
const LEADS_DIR   = path.join(ROOT, 'leads');

// ── TRADE SYNONYMS (--multi mode) ─────────────────────────────────────────────
// Multiple search queries widen coverage for the same trade.
// Deduplication by place_id ensures no double-billing for overlap.

const TRADE_SYNONYMS = {
  plumber:     ['plumber', 'plumbing company', 'drain cleaning service'],
  hvac:        ['HVAC contractor', 'air conditioning repair', 'heating and cooling'],
  electrician: ['electrician', 'electrical contractor', 'electrical repair'],
  roofer:      ['roofing contractor', 'roof repair', 'roofer'],
  handyman:    ['handyman', 'home repair service', 'handyman service']
};

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const city     = get('--city');
const trade    = get('--trade');
const limitArg = parseInt(get('--limit') || '30', 10);
const isMulti  = args.includes('--multi');

if (!city || !trade) {
  console.error('Usage: node scout.js --city "Denver, CO" --trade plumber [--multi] [--force]');
  process.exit(1);
}

const VALID_TRADES = ['plumber', 'hvac', 'electrician', 'roofer', 'handyman'];
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
      monthly_cap:      10.00,
      cost_per_result:  0.001,
      current_month:    currentMonth(),
      spent_this_month: 0.00,
      total_runs:       0,
      last_run:         null,
      auto_run:         false,
      default_limit:    30
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function checkAutoRun(config) {
  if (args.includes('--force')) return;
  if (!config.auto_run) {
    console.log('Scout is in manual mode (auto_run = false).');
    console.log('Run with --force to execute now, or set auto_run = true in config/scout-config.json.');
    process.exit(0);
  }
}

// ── BUDGET CHECK ──────────────────────────────────────────────────────────────

function checkBudget(config, estimatedCost) {
  if (config.current_month !== currentMonth()) {
    config.current_month    = currentMonth();
    config.spent_this_month = 0;
    console.log('New month detected — spend counter reset to $0.00');
  }

  const remaining = config.monthly_cap - config.spent_this_month;

  if (remaining <= 0) {
    console.error(`BUDGET CAP REACHED: $${config.spent_this_month.toFixed(2)} of $${config.monthly_cap.toFixed(2)} used this month.`);
    console.error('Scout is blocked until next month. Raise monthly_cap in config/scout-config.json to continue.');
    process.exit(1);
  }

  if (estimatedCost > remaining) {
    const maxTotal = Math.floor(remaining / config.cost_per_result);
    console.warn(`Budget warning: $${remaining.toFixed(2)} remaining. Capping at ${maxTotal} total results.`);
    return maxTotal;
  }

  return limitArg;
}

function updateSpend(config, rawCount, qualifyingCount) {
  const cost = rawCount * config.cost_per_result;
  config.spent_this_month = parseFloat((config.spent_this_month + cost).toFixed(4));
  config.total_runs += 1;
  config.last_run   = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  recordOutscraper(rawCount, config.cost_per_result);
  const effectiveCpp = qualifyingCount > 0 ? cost / qualifyingCount : null;
  return { cost, effectiveCpp };
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

async function callOutscraper(query, limit) {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) throw new Error('OUTSCRAPER_API_KEY not set. Add it to .env.local');

  const params = new URLSearchParams({
    query:    `${query} in ${city}`,
    limit:    String(limit),
    language: 'en',
    region:   'us',
    fields:   'name,email,phone,site,full_address,rating,reviews,subtypes,place_id,latitude,longitude'
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

  // No website — constant for all qualifying leads (filter requires it)
  if (!result.site || result.site.trim() === '') score += 3;

  // Review count buckets — sweet spot is low-to-mid (visible but not dominant)
  const reviews = result.reviews || 0;
  if      (reviews >= 10 && reviews <= 30)  score += 4;
  else if (reviews >= 31 && reviews <= 80)  score += 3;
  else if (reviews >= 81 && reviews <= 150) score += 2;
  else if (reviews > 150)                   score += 1;

  // Rating quality
  const rating = result.rating || 0;
  if      (rating >= 4.8) score += 2;
  else if (rating >= 4.5) score += 1;

  // Email present — rare for contractors, signals more complete listing
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

function filterAndFormat(results, tradeStr, cityStr) {
  const channel = channelForTrade(tradeStr);

  let discardedReviews = 0;
  let discardedRating  = 0;
  let discardedWebsite = 0;
  let discardedNoPhone = 0;

  const leads = [];

  for (const r of results) {
    if (!r.reviews || r.reviews < 5 || r.reviews > 300) { discardedReviews++; continue; }
    if (!r.rating  || r.rating  < 4.0)                  { discardedRating++;  continue; }
    if (r.site && r.site.trim() !== '')                  { discardedWebsite++; continue; }
    if (!r.phone   || r.phone.trim() === '')             { discardedNoPhone++; continue; }

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
      gap_score:     scoreGap(r),
      channel,
      notes:         '',
      scraped_at:    new Date().toISOString()
    });
  }

  console.log(`  Channel: ${channel} (${tradeStr})`);
  console.log(`  Filter breakdown (${results.length} raw):`);
  console.log(`    Kept:                          ${leads.length}`);
  console.log(`    Reviews out of range (5-300):  ${discardedReviews}`);
  console.log(`    Rating below 4.0:              ${discardedRating}`);
  console.log(`    Has existing website:          ${discardedWebsite}`);
  console.log(`    No valid phone:                ${discardedNoPhone}`);

  return leads.sort((a, b) => b.gap_score - a.gap_score);
}

// ── FILENAME — no overwrites on same-day runs ─────────────────────────────────

function buildFilename(cityStr) {
  const dateStr   = new Date().toISOString().split('T')[0];
  const citySlug  = slugify(cityStr);
  const tradeSlug = slugify(trade);
  const base      = `${citySlug}-${tradeSlug}-${dateStr}`;

  let index = 1;
  while (fs.existsSync(path.join(LEADS_DIR, `${base}-run${index}.json`))) {
    index++;
  }
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
  console.log(`\nScout starting — ${trade} in ${city}${isMulti ? ' [multi-query]' : ''}`);
  console.log('─'.repeat(50));

  const config = loadConfig();
  checkAutoRun(config);

  const queries        = isMulti ? (TRADE_SYNONYMS[trade.toLowerCase()] || [trade]) : [trade];
  const costPerResult  = config.cost_per_result || 0.001;
  const estimatedTotal = limitArg * queries.length * costPerResult;
  const budgetTotal    = checkBudget(config, estimatedTotal);
  const perQueryLimit  = Math.max(1, Math.floor(budgetTotal / queries.length));

  console.log(`Budget:   $${config.spent_this_month.toFixed(2)} / $${config.monthly_cap.toFixed(2)} used this month`);
  console.log(`Queries:  ${queries.length} (${isMulti ? '--multi' : 'single'})`);
  console.log(`Fetching: up to ${perQueryLimit} results per query (~$${(perQueryLimit * queries.length * costPerResult).toFixed(3)} estimated)`);
  console.log('');

  // Fetch all queries, then deduplicate by place_id
  const allRaw = [];
  for (const query of queries) {
    if (queries.length > 1) console.log(`  Query: "${query}"`);
    try {
      const results = await callOutscraper(query, perQueryLimit);
      allRaw.push(...(results.flat ? results.flat() : results));
    } catch (err) {
      writeLog('scout', [`WARN: query "${query}" failed — ${err.message}`]);
      console.warn(`  Skipping failed query "${query}": ${err.message}`);
    }
  }

  if (allRaw.length === 0) {
    console.error('All Outscraper queries failed or returned no results.');
    process.exit(1);
  }

  // Deduplicate by place_id (multi-query can return same business from different searches)
  const seen = new Set();
  const flat = [];
  for (const r of allRaw) {
    const key = r.place_id || r.name;
    if (!seen.has(key)) {
      seen.add(key);
      flat.push(r);
    }
  }
  if (isMulti) console.log(`  Deduped: ${allRaw.length} raw → ${flat.length} unique\n`);

  const leads = filterAndFormat(flat, trade, city);

  if (leads.length === 0) {
    console.warn('\nNo qualifying leads found after filtering. Try a different city or trade.');
    console.warn(`Raw results from Outscraper: ${flat.length}`);
    process.exit(0);
  }

  const filename = buildFilename(city);
  const outPath  = path.join(LEADS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));

  const { cost: actualCost, effectiveCpp } = updateSpend(config, flat.length, leads.length);
  const newCount = updateState(leads);

  writeLog('scout', [
    `city: ${city}  trade: ${trade}${isMulti ? '  [multi]' : ''}`,
    `raw: ${flat.length}  qualifying: ${leads.length}  new: ${newCount}`,
    `cost: $${actualCost.toFixed(4)}  effective: ${effectiveCpp ? '$' + effectiveCpp.toFixed(4) + '/lead' : 'n/a'}  monthly: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`,
    `file: leads/${filename}`
  ]);

  console.log(`\nDone.`);
  console.log(`  Leads qualifying: ${leads.length} (of ${flat.length} raw)`);
  console.log(`  New (not dupe):   ${newCount}`);
  console.log(`  Cost this run:    $${actualCost.toFixed(4)}`);
  if (effectiveCpp) console.log(`  Effective cost:   $${effectiveCpp.toFixed(4)}/qualifying lead`);
  console.log(`  Monthly spend:    $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log(`  Saved to:         leads/${filename}`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
