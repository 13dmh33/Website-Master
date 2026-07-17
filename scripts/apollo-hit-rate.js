#!/usr/bin/env node
/**
 * Apollo hit-rate rollup — reads the additive apolloAttempted/apolloHit/
 * apolloCreditSpent fields Enricher now stamps onto lead records and
 * reports the hit rate and cost per successful email. Read-only: makes no
 * Apollo calls, spends no credits, writes no lead files.
 *
 * "Phone-only" = Enricher's no-website mode (leads/*.json) — matches the
 * literal business-context framing in the session scope doc. has-website
 * mode (leads-web/*.json — a real site exists, just no scrapeable email)
 * is reported as a separate breakdown, not blended into the headline
 * number, since those leads aren't actually phone-only. See DISCOVERY.md.
 *
 * Usage:
 *   node scripts/apollo-hit-rate.js              # console + append to Sheet tab "ApolloMetrics"
 *   node scripts/apollo-hit-rate.js --no-sheet    # console only, skip Sheets
 *
 * Reads:  leads/*.json, leads-web/*.json, leads-web/needs-email-*.json
 * Writes: nothing local. Appends one row per mode to the "ApolloMetrics"
 *         Sheet tab (created if missing) unless --no-sheet or Sheets
 *         credentials aren't configured, in which case it logs and
 *         continues rather than failing.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');

const { computeApolloMetrics } = require('./lib/apollo-metrics');
const {
  DEFAULT_SHEET_ID, loadServiceAccount, getAccessToken, ensureTab, sheetsAppend,
} = require('./lib/google-sheets');

const ROOT = path.join(__dirname, '..');
const LEADS_DIR = path.join(ROOT, 'leads');
const LEADS_WEB_DIR = path.join(ROOT, 'leads-web');
const TAB_NAME = 'ApolloMetrics';

const noSheet = process.argv.includes('--no-sheet');

function readJsonArraySafe(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** no-website mode — genuinely phone-only leads. */
function loadPhoneOnlyLeads() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  const files = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));
  return files.flatMap(f => readJsonArraySafe(path.join(LEADS_DIR, f)));
}

/**
 * has-website mode — a real site exists, Apollo was used to find an email
 * on it. Hits move out of needs-email-*.json into {basename}.json (see
 * enricher.js's moveHasWebsiteLeadToAuditorReady); misses stay in
 * needs-email-*.json. Scanning both, filtered to apolloAttempted === true,
 * captures each lead exactly once regardless of which file it landed in.
 */
function loadHasWebsiteLeads() {
  if (!fs.existsSync(LEADS_WEB_DIR)) return [];
  const files = fs.readdirSync(LEADS_WEB_DIR).filter(f => f.endsWith('.json'));
  return files.flatMap(f => readJsonArraySafe(path.join(LEADS_WEB_DIR, f)));
}

function formatPct(v) { return v === null ? 'n/a' : `${v}%`; }
function formatUsd(v) { return v === null ? 'n/a' : `$${v.toFixed(4)}`; }

function printSummary(label, m) {
  console.log(`\n${label}`);
  console.log(`  attempted:              ${m.attempted}`);
  console.log(`  hits:                   ${m.hits}`);
  console.log(`  misses:                 ${m.misses}`);
  console.log(`  hit rate:               ${formatPct(m.hitRatePct)}`);
  console.log(`  credits spent:          ${m.creditsSpent}`);
  console.log(`  cost:                   ${formatUsd(m.costUsd)}`);
  console.log(`  cost per successful email: ${formatUsd(m.costPerHitUsd)}`);
}

const HEADER_ROW = [
  'date', 'mode', 'attempted', 'hits', 'misses',
  'hit rate %', 'credits spent', 'cost usd', 'cost per successful email usd',
];

async function appendToSheet(rows) {
  let sa;
  try {
    sa = loadServiceAccount();
  } catch (err) {
    console.log(`\n[sheet] skipped — ${err.message}`);
    return;
  }
  try {
    const token = await getAccessToken(sa);
    const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
    const justCreated = await ensureTab(token, sheetId, TAB_NAME);
    if (justCreated) {
      await sheetsAppend(token, sheetId, TAB_NAME, [HEADER_ROW]);
    }
    await sheetsAppend(token, sheetId, TAB_NAME, rows);
    console.log(`\n[sheet] appended ${rows.length} row(s) to "${TAB_NAME}"`);
  } catch (err) {
    console.log(`\n[sheet] write failed, continuing (read/log-only tool — never throws): ${err.message}`);
  }
}

async function main() {
  console.log('Apollo hit-rate rollup');
  console.log('─'.repeat(50));

  const phoneOnly = computeApolloMetrics(loadPhoneOnlyLeads());
  const hasWebsite = computeApolloMetrics(loadHasWebsiteLeads());

  printSummary('Phone-only leads (no-website mode) — the headline number', phoneOnly);
  printSummary('Has-website leads (site exists, no scrapeable email)', hasWebsite);

  console.log('\n' + '─'.repeat(50));
  if (phoneOnly.attempted === 0 && hasWebsite.attempted === 0) {
    console.log('No Enricher runs recorded yet since this instrumentation shipped.');
    console.log('This measures forward from deploy — no historical backfill (see DISCOVERY.md).');
  }

  if (!noSheet) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      [today, 'phone_only', phoneOnly.attempted, phoneOnly.hits, phoneOnly.misses,
        phoneOnly.hitRatePct ?? '', phoneOnly.creditsSpent, phoneOnly.costUsd ?? '', phoneOnly.costPerHitUsd ?? ''],
      [today, 'has_website', hasWebsite.attempted, hasWebsite.hits, hasWebsite.misses,
        hasWebsite.hitRatePct ?? '', hasWebsite.creditsSpent, hasWebsite.costUsd ?? '', hasWebsite.costPerHitUsd ?? ''],
    ];
    await appendToSheet(rows);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
