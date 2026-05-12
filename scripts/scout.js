#!/usr/bin/env node
/**
 * Scout — Google Maps lead finder via Outscraper
 *
 * Usage:
 *   node scripts/scout.js --city "Denver, CO" --trade plumber --force
 *   node scripts/scout.js --city "Austin, TX" --trade hvac --limit 20 --force
 *
 * Reads:  config/scout-config.json  (budget + settings)
 *         .env.local                (OUTSCRAPER_API_KEY)
 * Writes: leads/{city}-{date}-{run}.json
 *         state.json (appends new lead IDs)
 *         config/scout-config.json (updates spend)
 *
 * Known limitation: Outscraper Maps v3 may return async task IDs instead of
 * direct results on some plans. If you see empty results, check TODO below.
 * TODO: Add polling support for async Outscraper task responses.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'scout-config.json');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR = path.join(ROOT, 'leads');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const city = get('--city');
const trade = get('--trade');
const limitArg = parseInt(get('--limit') || '30', 10);

if (!city || !trade) {
  console.error('Usage: node scout.js --city "Denver, CO" --trade plumber --force');
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
      monthly_cap: 10.00,
      cost_per_result: 0.001,
      current_month: currentMonth(),
      spent_this_month: 0.00,
      total_runs: 0,
      last_run: null,
      auto_run: false,
      default_limit: 30
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
    config.current_month = currentMonth();
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
    const maxResults = Math.floor(remaining / config.cost_per_result);
    console.warn(`Budget warning: $${remaining.toFixed(2)} remaining. Reducing limit from ${limitArg} to ${maxResults} results.`);
    return maxResults;
  }

  return limitArg;
}

function updateSpend(config, resultsCount) {
  const cost = resultsCount * config.cost_per_result;
  config.spent_this_month = parseFloat((config.spent_this_month + cost).toFixed(4));
  config.total_runs += 1;
  config.last_run = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return cost;
}

// ── OUTSCRAPER API ────────────────────────────────────────────────────────────

function callOutscraper(query, limit) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OUTSCRAPER_API_KEY;
    if (!apiKey) {
      reject(new Error('OUTSCRAPER_API_KEY not set. Add it to .env.local'));
      return;
    }

    const params = new URLSearchParams({
      query: `${query} in ${city}`,
      limit: String(limit),
      language: 'en',
      region: 'us',
      fields: 'name,phone,site,full_address,rating,reviews,subtypes,place_id,latitude,longitude'
    });

    const options = {
      hostname: 'api.app.outscraper.com',
      path: `/maps/search-v3?${params}`,
      method: 'GET',
      headers: { 'X-API-KEY': apiKey }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // TODO: If parsed.id exists and parsed.data is empty, this is an async
          // task response. Need to poll GET /tasks/{id} until status = 'Success'.
          if (parsed.status === 'Success' || parsed.data) {
            resolve(parsed.data || []);
          } else {
            reject(new Error(`Outscraper error: ${JSON.stringify(parsed)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Outscraper response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ── LEAD FILTERING ────────────────────────────────────────────────────────────

function scoreGap(result) {
  let score = 0;

  if (!result.site || result.site === '') score += 4;

  const reviews = result.reviews || 0;
  if (reviews >= 10 && reviews <= 60) score += 3;
  else if (reviews > 60 && reviews <= 100) score += 1;

  const rating = result.rating || 0;
  if (rating >= 4.5) score += 2;
  else if (rating >= 4.0) score += 1;

  return Math.min(score, 10);
}

function channelForTrade(t) {
  const map = {
    plumber: 'email',
    hvac: 'email',
    electrician: 'sms',
    roofer: 'sms',
    handyman: 'ig_dm'
  };
  return map[t.toLowerCase()] || 'email';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function filterAndFormat(results, tradeStr, cityStr) {
  return results
    .filter(r => {
      if (!r.reviews || r.reviews < 5) return false;
      if (r.reviews > 100) return false;
      if (!r.rating || r.rating < 4.0) return false;
      return true;
    })
    .map(r => ({
      lead_id: r.place_id || `${slugify(r.name)}-${slugify(cityStr)}`,
      business_name: r.name || '',
      trade: tradeStr,
      city: cityStr,
      // NOTE: Outscraper does not return years_on_maps directly.
      // This field is null until a future enrichment step adds it.
      // The "5+ years on Maps" filter is not enforced at Scout time.
      years_on_maps: null,
      review_count: r.reviews || 0,
      rating: r.rating || 0,
      website: r.site || 'none',
      phone: r.phone || '',
      address: r.full_address || '',
      place_id: r.place_id || null,
      gap_score: scoreGap(r),
      channel: channelForTrade(tradeStr),
      notes: '',
      scraped_at: new Date().toISOString()
    }))
    .sort((a, b) => b.gap_score - a.gap_score);
}

// ── FILENAME — no overwrites on same-day runs ─────────────────────────────────

function buildFilename(cityStr) {
  const dateStr = new Date().toISOString().split('T')[0];
  const citySlug = slugify(cityStr);
  const tradeSlug = slugify(trade);
  const base = `${citySlug}-${tradeSlug}-${dateStr}`;

  // Find next available run index (run1, run2, ...) so no file is overwritten
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
  console.log(`\nScout starting — ${trade} in ${city}`);
  console.log('─'.repeat(50));

  const config = loadConfig();
  checkAutoRun(config);

  const costPerResult = config.cost_per_result || 0.001;
  const estimatedCost = limitArg * costPerResult;
  const effectiveLimit = checkBudget(config, estimatedCost);

  console.log(`Budget:   $${config.spent_this_month.toFixed(2)} / $${config.monthly_cap.toFixed(2)} used this month`);
  console.log(`Rate:     $${costPerResult} per result (set in config/scout-config.json)`);
  console.log(`Fetching: up to ${effectiveLimit} results (~$${(effectiveLimit * costPerResult).toFixed(2)} estimated)`);
  console.log('');

  let results;
  try {
    results = await callOutscraper(trade, effectiveLimit);
  } catch (err) {
    console.error(`Outscraper call failed: ${err.message}`);
    process.exit(1);
  }

  const flat = results.flat ? results.flat() : results;
  const leads = filterAndFormat(flat, trade, city);

  if (leads.length === 0) {
    console.warn('No qualifying leads found after filtering. Try a different city or trade.');
    console.warn(`Raw results from Outscraper: ${flat.length}`);
    process.exit(0);
  }

  const filename = buildFilename(city);
  const outPath = path.join(LEADS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));

  const actualCost = updateSpend(config, flat.length);
  const newCount = updateState(leads);

  console.log(`Done.`);
  console.log(`  Leads qualifying: ${leads.length} (of ${flat.length} raw)`);
  console.log(`  New (not dupe):   ${newCount}`);
  console.log(`  Cost this run:    $${actualCost.toFixed(4)}`);
  console.log(`  Monthly spend:    $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log(`  Saved to:         leads/${filename}`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
