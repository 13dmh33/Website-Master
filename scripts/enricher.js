#!/usr/bin/env node
/**
 * Enricher — Apollo.io email lookup for leads missing contact info
 *
 * Usage:
 *   node scripts/enricher.js --dry-run --force   # preview, no API calls
 *   node scripts/enricher.js --force             # run for real
 *   node scripts/enricher.js --limit 20 --force  # cap lookups this run
 *
 * Reads:  leads/*.json              (finds leads without email)
 *         queue/*-brief.json        (upgrades channel if lead already queued)
 * Writes: leads/*.json              (email + enriched_at)
 *         queue/*-brief.json        (channel: email, secondary_channel: sms)
 *         config/enricher-config.json
 *         logs/{date}.log
 *
 * Env: APOLLO_API_KEY
 *   Get one at https://app.apollo.io/#/settings/integrations/api
 *   Basic plan: $49/mo → ~1,000 export credits
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { writeLog }    = require('./logger');
const { recordApollo } = require('./cost-tracker');

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'enricher-config.json');
const LEADS_DIR   = path.join(ROOT, 'leads');
const QUEUE_DIR   = path.join(ROOT, 'queue');

const args     = process.argv.slice(2);
const getArg   = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const isDry    = args.includes('--dry-run');
const limitArg = parseInt(getArg('--limit') || '50', 10);

// ── CONFIG ────────────────────────────────────────────────────────────────────

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      monthly_cap_credits: 200,
      current_month:       currentMonth(),
      credits_used:        0,
      total_runs:          0,
      last_run:            null,
      auto_run:            false
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function checkAutoRun(cfg) {
  if (args.includes('--force')) return;
  if (!cfg.auto_run) {
    console.log('Enricher is in manual mode. Run with --force, or --dry-run --force to preview.');
    process.exit(0);
  }
}

function checkBudget(cfg) {
  if (cfg.current_month !== currentMonth()) {
    cfg.current_month = currentMonth();
    cfg.credits_used  = 0;
    console.log('New month — credit counter reset to 0');
  }
  const remaining = cfg.monthly_cap_credits - cfg.credits_used;
  if (remaining <= 0) {
    console.error(`Credit cap reached: ${cfg.credits_used} / ${cfg.monthly_cap_credits} this month.`);
    console.error('Raise monthly_cap_credits in config/enricher-config.json to continue.');
    process.exit(1);
  }
  return Math.min(remaining, limitArg);
}

// ── LEAD SCANNER ──────────────────────────────────────────────────────────────

function findLeadsNeedingEmail() {
  const results = [];
  const files   = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8'));
      for (const lead of leads) {
        if (!lead.email || lead.email.trim() === '') {
          // Skip if already enriched with no result (don't waste credits on re-tries)
          if (lead.enriched_at && !lead.email) continue;
          results.push({ lead, file });
        }
      }
    } catch { /* skip malformed file */ }
  }
  return results;
}

// ── APOLLO API ────────────────────────────────────────────────────────────────

function apolloPost(endpoint, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ ...payload, api_key: apiKey });
    const options = {
      hostname: 'api.apollo.io',
      path:     endpoint,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Cache-Control':  'no-cache',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error(`Apollo parse error: ${data.slice(0, 200)}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function lookupEmail(lead, apiKey) {
  // Parse "Denver, CO" → { city: "Denver", state: "CO" }
  const parts     = (lead.city || '').split(',').map(s => s.trim());
  const cityName  = parts[0] || '';
  const stateCode = parts[1] || '';

  // Apollo People Match — fuzzy-matches a person by org + location.
  // Phone improves accuracy significantly; include when available.
  const payload = {
    organization_name: lead.business_name,
    city:              cityName,
    state:             stateCode,
    country:           'US'
  };

  if (lead.phone) {
    // Strip formatting — Apollo expects digits only
    const digits = lead.phone.replace(/\D/g, '');
    if (digits.length >= 10) payload.phone = digits;
  }

  const { status, body } = await apolloPost('/v1/people/match', payload, apiKey);

  if (status === 200 && body.person?.email) {
    return {
      email:        body.person.email.toLowerCase().trim(),
      email_status: body.person.email_status || 'unknown',
      name:         [body.person.first_name, body.person.last_name].filter(Boolean).join(' '),
      title:        body.person.title || ''
    };
  }

  // 422 / 404 = no match — normal, not an error
  if (status === 422 || status === 404) return null;

  // 429 = rate limited — bubble up so caller can back off
  if (status === 429) throw new Error('RATE_LIMIT');

  // Other 4xx/5xx — log and continue
  if (status >= 400) {
    const msg = body?.message || body?.error || JSON.stringify(body).slice(0, 100);
    throw new Error(`Apollo ${status}: ${msg}`);
  }

  return null;
}

// ── UPDATERS ──────────────────────────────────────────────────────────────────

function updateLeadFile(file, leadId, email, meta) {
  const filePath = path.join(LEADS_DIR, file);
  const leads    = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (const lead of leads) {
    if (lead.lead_id === leadId) {
      lead.email          = email;
      lead.email_status   = meta.email_status;
      lead.enriched_name  = meta.name  || null;
      lead.enriched_title = meta.title || null;
      lead.enriched_at    = new Date().toISOString();
      break;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(leads, null, 2));
}

function markNoEmail(file, leadId) {
  // Record that we tried — prevents burning credits on repeat lookups
  const filePath = path.join(LEADS_DIR, file);
  const leads    = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (const lead of leads) {
    if (lead.lead_id === leadId) {
      lead.enriched_at = new Date().toISOString();
      break;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(leads, null, 2));
}

function upgradeBriefToEmail(leadId, email) {
  const briefPath = path.join(QUEUE_DIR, `${leadId}-brief.json`);
  if (!fs.existsSync(briefPath)) return false;

  try {
    const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));

    // Only upgrade if the brief was phone-only; don't overwrite existing email briefs
    if (brief.email || brief.channel === 'email') return false;

    brief.email             = email;
    brief.channel           = 'email';
    brief.secondary_channel = brief.phone ? 'sms' : null;
    brief.enriched_at       = new Date().toISOString();
    brief.enrichment_note   = 'Email found via Apollo — channel upgraded from sms to email';

    fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
    return true;
  } catch {
    return false;
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nEnricher starting${isDry ? ' [DRY RUN]' : ''}`);
  console.log('─'.repeat(50));

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    console.error('APOLLO_API_KEY not set. Add it to .env.local');
    console.error('Get a key at: https://app.apollo.io/#/settings/integrations/api');
    console.error('Basic plan ($49/mo) gives ~1,000 credits — plenty for a month of enrichment.');
    process.exit(1);
  }

  const cfg        = loadConfig();
  checkAutoRun(cfg);
  const budget     = checkBudget(cfg);
  const candidates = findLeadsNeedingEmail();
  const toProcess  = candidates.slice(0, budget);

  console.log(`Leads needing email:     ${candidates.length}`);
  console.log(`Processing this run:     ${toProcess.length}  (limit: ${limitArg}, budget: ${budget})`);
  console.log(`Credits used this month: ${cfg.credits_used} / ${cfg.monthly_cap_credits}`);
  if (isDry) console.log('\n[DRY RUN — no API calls, no file writes]\n');
  console.log('─'.repeat(50));

  if (candidates.length === 0) {
    console.log('All leads already enriched. Nothing to do.');
    process.exit(0);
  }

  let found = 0, noMatch = 0, errors = 0, briefsUpgraded = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { lead, file } = toProcess[i];
    const label = `[${i + 1}/${toProcess.length}] ${lead.business_name} (${lead.city})`;

    if (isDry) {
      console.log(`${label} — would lookup`);
      continue;
    }

    try {
      const result = await lookupEmail(lead, apiKey);

      if (result?.email) {
        updateLeadFile(file, lead.lead_id, result.email, result);
        const upgraded = upgradeBriefToEmail(lead.lead_id, result.email);
        if (upgraded) briefsUpgraded++;

        recordApollo(1, 'enricher');
        cfg.credits_used++;
        saveConfig(cfg);
        found++;

        const upgradedNote = upgraded ? ' → brief upgraded to email' : '';
        console.log(`  ✓  ${label}`);
        console.log(`     ${result.email}  [${result.email_status}]  ${result.name || ''}${upgradedNote}`);
      } else {
        markNoEmail(file, lead.lead_id);
        noMatch++;
        console.log(`  —  ${label}  (no match)`);
      }

      // Stay well under Apollo's rate limit (50 req/s) — 1.2s gap is safe
      if (i < toProcess.length - 1) await sleep(1200);

    } catch (err) {
      if (err.message === 'RATE_LIMIT') {
        console.warn(`  ⚠  Rate limited — waiting 60s before continuing...`);
        await sleep(60000);
        i--; // retry this lead
        continue;
      }
      errors++;
      console.error(`  ✗  ${label}  ERROR: ${err.message}`);
    }
  }

  cfg.total_runs++;
  cfg.last_run = new Date().toISOString();
  saveConfig(cfg);

  writeLog('enricher', [
    `found: ${found}  no_match: ${noMatch}  errors: ${errors}`,
    `briefs_upgraded: ${briefsUpgraded}`,
    `credits_used_total: ${cfg.credits_used} / ${cfg.monthly_cap_credits}`
  ]);

  console.log('\n' + '─'.repeat(50));
  console.log('Done.');
  console.log(`  Email found:        ${found}`);
  console.log(`  No Apollo match:    ${noMatch}`);
  console.log(`  Errors:             ${errors}`);
  console.log(`  Briefs upgraded:    ${briefsUpgraded}  (channel sms → email)`);
  console.log(`  Credits used total: ${cfg.credits_used} / ${cfg.monthly_cap_credits}`);
  console.log('─'.repeat(50));

  if (found > 0) {
    console.log('');
    if (briefsUpgraded > 0) {
      console.log(`Next: run Pitcher — ${briefsUpgraded} brief(s) upgraded to email channel, ready to send.`);
    } else {
      console.log(`Next: run Diagnoser → Checker → Personalizer → Pitcher for ${found} newly enriched lead(s).`);
    }
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
