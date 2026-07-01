#!/usr/bin/env node
/**
 * Aggregator Scraper — finds aggregator orgs (license-prep schools, bond/
 * insurance agents, SBDC/SCORE centers, trade schools) where about-to-launch
 * tradespeople cluster, so Trevo can get listed on their recommended-vendor
 * / resource lists once and drip referrals for years.
 *
 * This is a NEW, separate pipeline from Scout (scripts/scout.js) — it does
 * not touch leads/, leads-web/, or any existing Scout config. Outscraper
 * calls are blocked from the container (same as Scout) — run with a real
 * OUTSCRAPER_API_KEY on Mac. --dry-run works anywhere (no API calls).
 *
 * Usage:
 *   node aggregator/scripts/scraper.js --lane license_prep --state CO --force
 *   node aggregator/scripts/scraper.js --lane bonding_insurance --city "Denver, CO" --force
 *   node aggregator/scripts/scraper.js --lane sbdc_score --city "Denver, CO" --force
 *   node aggregator/scripts/scraper.js --lane trade_school --state CO --trade electrical --force
 *   node aggregator/scripts/scraper.js --lane trade_school --state CO --all-programs --force
 *   node aggregator/scripts/scraper.js --lane license_prep --state CO --dry-run
 *
 * Reads:  aggregator/config/scraper-config.json (budget + settings)
 *         .env.local                            (OUTSCRAPER_API_KEY)
 *         aggregator/leads/*.json                (pre-dedup history)
 * Writes: aggregator/leads/{lane}-{date}-run{n}.json
 *         aggregator/leads/{lane}-{date}-run{n}.csv
 *         aggregator/leads/needs-email-{lane}-{date}-run{n}.csv (fallback, if any)
 *         state.json    (additive — new queue records, lane: 'aggregator')
 *         aggregator/config/scraper-config.json (spend tracking)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.local') });

const fs = require('fs');
const path = require('path');
const https = require('https');

const { slugify } = require('../../scripts/lib/scout-shared');
const { LANES, TRADE_SCHOOL_DEFAULT_TRADES, mapsQueriesForLane, fetchSbdcSeeds, fetchScoreSeeds } = require('../lib/sources');
const { buildDedupeIndex, dedupeOrgs } = require('../lib/dedupe');
const { exportOrgsToCsv, exportNeedsEmailToCsv } = require('../lib/csv');
const { buildTrackLink } = require('../lib/track-link');
const { loadState, saveState, upsertAggregatorLead, recordAggregatorRun } = require('../lib/state-writer');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'scraper-config.json');
const LEADS_DIR = path.join(__dirname, '..', 'leads');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);

const lane = get('--lane');
const stateArg = get('--state');
const cityArg = get('--city');
const tradeArg = get('--trade');
const limitArg = parseInt(get('--limit') || '20', 10);
const budgetArg = parseFloat(get('--budget') || '0');
const isDryRun = hasFlag('--dry-run');
const exportCsv = !hasFlag('--no-csv');
const allPrograms = hasFlag('--all-programs') || process.env.TRADE_SCHOOL_ALL === 'true';

if (!lane || !LANES.includes(lane)) {
  console.error(`--lane is required and must be one of: ${LANES.join(', ')}`);
  process.exit(1);
}
if ((lane === 'license_prep' || lane === 'trade_school') && !stateArg) {
  console.error(`--lane ${lane} requires --state "CO"`);
  process.exit(1);
}
if ((lane === 'bonding_insurance' || lane === 'sbdc_score') && !cityArg) {
  console.error(`--lane ${lane} requires --city "Denver, CO"`);
  process.exit(1);
}

// ── CONFIG ────────────────────────────────────────────────────────────────────

function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      monthly_cap: 10.0,
      cost_per_result: 0.001,
      current_month: currentMonth(),
      spent_this_month: 0.0,
      total_runs: 0,
      total_orgs_found: 0,
      auto_run: false,
      last_run: null
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function checkAutoRun(config) {
  if (hasFlag('--force') || isDryRun) return;
  if (!config.auto_run) {
    console.log('Aggregator scraper is in manual mode (auto_run = false).');
    console.log('Run with --force, or set auto_run = true in aggregator/config/scraper-config.json.');
    process.exit(0);
  }
}

function checkBudget(config) {
  if (config.current_month !== currentMonth()) {
    config.current_month = currentMonth();
    config.spent_this_month = 0;
    console.log('New month detected — spend counter reset to $0.00');
  }
  const remaining = config.monthly_cap - config.spent_this_month;
  if (remaining <= 0) {
    console.error(`BUDGET CAP REACHED: $${config.spent_this_month.toFixed(2)} of $${config.monthly_cap.toFixed(2)} used this month.`);
    process.exit(1);
  }
  let effectiveLimit = limitArg;
  if (budgetArg > 0) effectiveLimit = Math.min(effectiveLimit, Math.floor(budgetArg / config.cost_per_result));
  const maxFromCap = Math.floor(remaining / config.cost_per_result);
  return Math.min(effectiveLimit, maxFromCap);
}

// ── OUTSCRAPER CALL (mirrors scripts/scout.js's callOutscraper pattern) ──────

function pollTask(resultsLocation, apiKey) {
  return new Promise((resolve, reject) => {
    const poll = () => {
      https.get(resultsLocation, { headers: { 'X-API-KEY': apiKey } }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { reject(e); return; }
          if (parsed.status === 'Success') resolve(parsed.data?.[0] || []);
          else setTimeout(poll, 3000);
        });
      }).on('error', reject);
    };
    poll();
  });
}

async function callOutscraper(query, limit, apiKey) {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    language: 'en',
    region: 'us',
    fields: 'name,email,phone,site,full_address,rating,reviews,place_id'
  });
  const options = {
    hostname: 'api.app.outscraper.com',
    path: `/maps/search-v3?${params}`,
    method: 'GET',
    headers: { 'X-API-KEY': apiKey }
  };
  const raw = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Failed to parse Outscraper response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
  if (raw.status === 'Success' && raw.data?.length > 0) return raw.data.flat();
  if (raw.id && raw.results_location) return pollTask(raw.results_location, apiKey);
  throw new Error(`Outscraper error: ${JSON.stringify(raw)}`);
}

// ── PARSING ───────────────────────────────────────────────────────────────────

function parseCityState(fullAddress) {
  if (!fullAddress) return { city: cityArg ? cityArg.split(',')[0].trim() : '', state: stateArg || '' };
  const parts = fullAddress.split(',').map((s) => s.trim());
  // "123 Main St, Denver, CO 80202" -> ["123 Main St", "Denver", "CO 80202"]
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  const stateZip = parts.length >= 1 ? parts[parts.length - 1] : '';
  const state = (stateZip.match(/^[A-Z]{2}\b/) || [stateArg || ''])[0];
  return { city: city || (cityArg || '').split(',')[0].trim(), state: state || stateArg || '' };
}

function inferProgramType(orgName, query) {
  const text = `${orgName} ${query}`.toLowerCase();
  for (const t of TRADE_SCHOOL_DEFAULT_TRADES) {
    if (text.includes(t)) return t;
  }
  return 'general';
}

function rawResultToOrg(raw, query) {
  const { city, state } = parseCityState(raw.full_address);
  const hasEmail = !!(raw.email && raw.email.trim());
  const org = {
    source_type: lane,
    org_name: raw.name || '',
    contact_email: hasEmail ? raw.email.trim() : '',
    role_tag: 'general',
    website: raw.site || '',
    phone: raw.phone || '',
    city,
    state,
    program_type: (lane === 'trade_school' || lane === 'license_prep') ? inferProgramType(raw.name || '', query) : '',
    track_link: '',
    notes: hasEmail ? '' : 'contact-form-only'
  };
  org.track_link = buildTrackLink(org);
  return org;
}

// ── DEDUP HISTORY ─────────────────────────────────────────────────────────────

function loadExistingOrgs() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  const files = fs.readdirSync(LEADS_DIR).filter((f) => f.endsWith('.json'));
  const orgs = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, f), 'utf8'));
      if (Array.isArray(data)) orgs.push(...data);
    } catch { /* skip unreadable file */ }
  }
  return orgs;
}

// ── FILE OUTPUT ───────────────────────────────────────────────────────────────

function buildFilename(prefix, ext) {
  const dateStr = new Date().toISOString().split('T')[0];
  let index = 1;
  while (fs.existsSync(path.join(LEADS_DIR, `${prefix}-${dateStr}-run${index}.${ext}`))) index++;
  return `${prefix}-${dateStr}-run${index}.${ext}`;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  checkAutoRun(config);
  fs.mkdirSync(LEADS_DIR, { recursive: true });

  const queries = mapsQueriesForLane(lane, { state: stateArg, city: cityArg, trade: tradeArg });
  if (queries.length === 0) {
    console.error('No queries generated for these arguments.');
    process.exit(1);
  }

  console.log(`Aggregator Scraper — lane: ${lane}`);
  console.log(`  Queries: ${queries.join(' | ')}`);

  let seedOrgs = [];
  if (lane === 'sbdc_score') {
    const [sbdc, score] = await Promise.all([fetchSbdcSeeds(), fetchScoreSeeds()]);
    seedOrgs = [...sbdc, ...score];
    if (seedOrgs.length) console.log(`  Structured seeds: ${seedOrgs.length}`);
  }

  if (isDryRun) {
    console.log('  --dry-run: no Outscraper calls made, no files written.');
    queries.forEach((q) => console.log(`  Would query: "${q}"`));
    return;
  }

  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) {
    console.error('OUTSCRAPER_API_KEY not set in .env.local — Outscraper calls are blocked from the container; run on Mac.');
    process.exit(1);
  }

  const effectiveLimit = checkBudget(config);
  if (effectiveLimit <= 0) {
    console.error('Effective limit is 0 after budget check — nothing to do.');
    process.exit(1);
  }

  let rawResults = [];
  for (const query of queries) {
    try {
      const results = await callOutscraper(query, effectiveLimit, apiKey);
      rawResults.push(...results.map((r) => ({ raw: r, query })));
    } catch (e) {
      console.error(`  Query failed: "${query}" — ${e.message}`);
    }
  }

  config.total_runs += 1;
  config.spent_this_month += rawResults.length * config.cost_per_result;
  config.last_run = new Date().toISOString();

  let orgs = rawResults.map(({ raw, query }) => rawResultToOrg(raw, query));
  orgs.push(...seedOrgs.map((s) => {
    const org = { source_type: lane, role_tag: 'general', program_type: '', notes: '', ...s };
    org.track_link = buildTrackLink(org);
    return org;
  }));

  // Trade-school default program filter
  if (lane === 'trade_school' && !allPrograms) {
    orgs = orgs.filter((o) => TRADE_SCHOOL_DEFAULT_TRADES.includes(o.program_type));
  }

  const existingOrgs = loadExistingOrgs();
  const dedupeIndex = buildDedupeIndex(existingOrgs);
  const newOrgs = dedupeOrgs(orgs, dedupeIndex);

  const withEmail = newOrgs.filter((o) => o.contact_email);
  const needsEmail = newOrgs.filter((o) => !o.contact_email && o.website);

  config.total_orgs_found += newOrgs.length;
  saveConfig(config);

  if (withEmail.length > 0) {
    const jsonFile = buildFilename(lane, 'json');
    fs.writeFileSync(path.join(LEADS_DIR, jsonFile), JSON.stringify(withEmail, null, 2));
    console.log(`  Wrote ${withEmail.length} orgs -> aggregator/leads/${jsonFile}`);

    if (exportCsv) {
      const csvFile = buildFilename(lane, 'csv');
      fs.writeFileSync(path.join(LEADS_DIR, csvFile), exportOrgsToCsv(withEmail));
      console.log(`  Wrote CSV -> aggregator/leads/${csvFile}`);
    }
  } else {
    console.log('  No new orgs with email found.');
  }

  if (needsEmail.length > 0) {
    const needsFile = buildFilename(`needs-email-${lane}`, 'csv');
    fs.writeFileSync(path.join(LEADS_DIR, needsFile), exportNeedsEmailToCsv(needsEmail));
    console.log(`  ${needsEmail.length} orgs need manual contact-page lookup -> aggregator/leads/${needsFile}`);
  }

  const state = loadState();
  for (const org of withEmail) {
    const leadId = slugify(`${org.source_type}-${org.org_name}-${org.city}`);
    upsertAggregatorLead(state, { leadId, status: 'scraped', sourceType: org.source_type, trackLink: org.track_link });
  }
  recordAggregatorRun(state, { newOrgCount: withEmail.length, drafted: 0 });
  saveState(state);

  console.log(`  Total found this run: ${newOrgs.length} (${withEmail.length} with email, ${needsEmail.length} needs-email fallback)`);
}

main().catch((e) => {
  console.error('Aggregator scraper failed:', e.message);
  process.exit(1);
});
