#!/usr/bin/env node
/**
 * Scout — Google Maps lead finder via Outscraper
 *
 * Usage:
 *   node scripts/scout.js --city "Denver, CO" --trade plumber
 *   node scripts/scout.js --city "Austin, TX" --trade hvac --limit 20
 *
 * Reads:  config/scout-config.json  (budget tracking)
 * Writes: leads/{city}-{date}.json
 *         state.json (appends new lead IDs)
 *         config/scout-config.json (updates spend)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'scout-config.json');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR = path.join(ROOT, 'leads');

// Outscraper charges per result — verify your rate in your dashboard.
// Default assumption: $0.001 per result (1000 results = $1.00)
const COST_PER_RESULT = 0.001;

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
  console.error('Usage: node scout.js --city "Denver, CO" --trade plumber');
  process.exit(1);
}

const VALID_TRADES = ['plumber', 'hvac', 'electrician', 'roofer', 'handyman'];
if (!VALID_TRADES.includes(trade.toLowerCase())) {
  console.error(`Trade must be one of: ${VALID_TRADES.join(', ')}`);
  process.exit(1);
}

// ── BUDGET CHECK ──────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      monthly_cap: 10.00,
      current_month: currentMonth(),
      spent_this_month: 0.00,
      total_runs: 0,
      last_run: null,
      auto_run: false,
      default_limit: 30,
      default_city: 'Denver, CO',
      default_trade: 'plumber'
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function checkAutoRun(config) {
  // --force flag bypasses the auto_run toggle (for manual on-demand runs)
  if (args.includes('--force')) return;

  if (!config.auto_run) {
    console.log('Scout is in manual mode (auto_run = false).');
    console.log('Run with --force to execute now, or set auto_run = true in config/scout-config.json to enable scheduled runs.');
    process.exit(0);
  }
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function checkBudget(config, estimatedCost) {
  // Reset spend counter if it's a new month
  if (config.current_month !== currentMonth()) {
    config.current_month = currentMonth();
    config.spent_this_month = 0;
    console.log('New month detected — spend counter reset to $0.00');
  }

  const remaining = config.monthly_cap - config.spent_this_month;

  if (remaining <= 0) {
    console.error(
      `BUDGET CAP REACHED: $${config.spent_this_month.toFixed(2)} spent of $${config.monthly_cap.toFixed(2)} cap this month.`
    );
    console.error('Scout is blocked until next month. Update config/scout-config.json to raise the cap.');
    process.exit(1);
  }

  if (estimatedCost > remaining) {
    const maxResults = Math.floor(remaining / COST_PER_RESULT);
    console.warn(
      `Budget warning: Only $${remaining.toFixed(2)} remaining. Reducing limit from ${limitArg} to ${maxResults} results.`
    );
    return maxResults;
  }

  return limitArg;
}

function updateSpend(config, resultsCount) {
  const cost = resultsCount * COST_PER_RESULT;
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
      reject(new Error('OUTSCRAPER_API_KEY not set in environment. Add it to .env.local'));
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
      headers: {
        'X-API-KEY': apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
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

  // No website = big opportunity
  if (!result.site || result.site === '') score += 4;

  // Review sweet spot: enough to be legit, not enough to be dominant
  const reviews = result.reviews || 0;
  if (reviews >= 10 && reviews <= 60) score += 3;
  else if (reviews > 60 && reviews <= 100) score += 1;

  // High rating = quality business worth helping
  const rating = result.rating || 0;
  if (rating >= 4.5) score += 2;
  else if (rating >= 4.0) score += 1;

  // Cap at 10
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
      // Must have reviews (real business)
      if (!r.reviews || r.reviews < 5) return false;
      // Under 100 reviews
      if (r.reviews > 100) return false;
      // Rating at or above 4.0
      if (!r.rating || r.rating < 4.0) return false;
      return true;
    })
    .map(r => ({
      lead_id: `${slugify(r.name)}-${slugify(cityStr)}`,
      business_name: r.name || '',
      trade: tradeStr,
      city: cityStr,
      years_on_maps: null,
      review_count: r.reviews || 0,
      rating: r.rating || 0,
      website: r.site || 'none',
      phone: r.phone || '',
      address: r.full_address || '',
      gap_score: scoreGap(r),
      channel: channelForTrade(tradeStr),
      notes: '',
      scraped_at: new Date().toISOString()
    }))
    .sort((a, b) => b.gap_score - a.gap_score);
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

  const estimatedCost = limitArg * COST_PER_RESULT;
  const effectiveLimit = checkBudget(config, estimatedCost);

  console.log(`Budget: $${config.spent_this_month.toFixed(2)} / $${config.monthly_cap.toFixed(2)} used this month`);
  console.log(`Fetching up to ${effectiveLimit} results (~$${(effectiveLimit * COST_PER_RESULT).toFixed(2)} estimated)...`);

  let results;
  try {
    results = await callOutscraper(trade, effectiveLimit);
  } catch (err) {
    console.error(`Outscraper call failed: ${err.message}`);
    process.exit(1);
  }

  const leads = filterAndFormat(results.flat ? results.flat() : results, trade, city);

  if (leads.length === 0) {
    console.warn('No qualifying leads found. Try a different city or trade.');
    process.exit(0);
  }

  // Save leads file
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${slugify(city)}-${dateStr}.json`;
  const outPath = path.join(LEADS_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(leads, null, 2));

  // Update budget and state
  const actualCost = updateSpend(config, results.length || leads.length);
  const newCount = updateState(leads);

  console.log(`\nDone.`);
  console.log(`  Leads found:    ${leads.length}`);
  console.log(`  New (not dupe): ${newCount}`);
  console.log(`  Cost this run:  $${actualCost.toFixed(4)}`);
  console.log(`  Monthly spend:  $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log(`  Saved to:       leads/${filename}`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
