#!/usr/bin/env node
/**
 * directory-scout — find contractor leads (with website URLs) from public
 * directories that expose them more reliably than Google Maps does.
 *
 *   Yellow Pages : most site_urls per run — feeds contact-scraper directly.
 *   BBB          : established/accredited businesses; some site_urls, all phone.
 *   Licensing    : CSV export of a state board — verified roster, name/phone.
 *
 * Usage (run on the Mac — container egress is proxy-gated, same as Scout):
 *   node scripts/directory-scout.js --source yellowpages --trade plumber --city "Denver, CO"
 *   node scripts/directory-scout.js --source bbb        --trade electrician --city "Austin, TX" --pages 3
 *   node scripts/directory-scout.js --source licensing  --file exports/tdlr.csv --trade plumber --city "Austin, TX"
 *
 *   --pages N       number of result pages to fetch (yellowpages/bbb; default 2)
 *   --file PATH     local CSV to ingest (licensing source only)
 *   --html PATH     parse a page you saved from the browser instead of fetching
 *                   (offline validation/debug for yellowpages/bbb — see below)
 *   --save-html DIR dump each fetched page to DIR for inspection
 *   --limit N       cap usable leads written this run
 *   --dry-run       parse + dedup, print results, write nothing
 *   --csv           also write a leads-web/ CSV of the usable leads
 *
 * If a live run fetches pages OK but parses 0 listings, the site markup changed:
 * the runner says so loudly and points you at --html/--save-html so the parser
 * can be re-validated offline (and the saved page handed back for a regex fix).
 *
 * Output is Scout-shaped: usable leads land in leads/*.json + state.json queue
 * as 'scouted'. Run order after this:
 *   node scripts/contact-scraper.js   (fills emails from site_urls)
 *   node scripts/diagnoser.js  →  checker.js  →  pitcher.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const dir  = require('./lib/directory-scout');

const ADAPTERS = {
  yellowpages: require('./lib/dir-yellowpages'),
  bbb:         require('./lib/dir-bbb'),
  licensing:   require('./lib/dir-licensing'),
};
// friendly aliases
ADAPTERS.yp = ADAPTERS.yellowpages;

function getArg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = flag => process.argv.includes(flag);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const sourceKey = (getArg('--source') || '').toLowerCase();
  const adapter   = ADAPTERS[sourceKey];
  const trade     = getArg('--trade');
  const city      = getArg('--city');
  const pages     = parseInt(getArg('--pages', '2'), 10) || 2;
  const limit     = parseInt(getArg('--limit', ''), 10) || Infinity;
  const file      = getArg('--file');
  const htmlFile  = getArg('--html');      // offline: parse a saved page (yellowpages/bbb debugging)
  const saveHtml  = getArg('--save-html'); // dump each fetched page to this dir for inspection
  const DRY_RUN   = has('--dry-run');
  const WRITE_CSV = has('--csv');

  if (!adapter) {
    console.error(`Usage: --source <yellowpages|bbb|licensing>  (got: "${sourceKey || 'none'}")`);
    process.exit(1);
  }
  if (!trade || !city) {
    console.error('Both --trade and --city are required (city may include state, e.g. "Denver, CO").');
    process.exit(1);
  }

  // HVAC is excluded company-wide (conflict of interest) — never scout it.
  if (/hvac|air condition|heating/i.test(trade)) {
    console.error('HVAC is excluded (conflict of interest). Pick plumber/electrician/handyman/roofer.');
    process.exit(1);
  }

  console.log(`\nDirectory Scout — ${adapter.SOURCE}: ${trade} in ${city}${DRY_RUN ? '   [DRY RUN]' : ''}`);
  console.log('─'.repeat(58));

  // ── gather raw listings ──
  let raw = [];
  let fetchErrors = 0, fetched = 0;

  let pagesFetchedOk = 0; // HTTP 200s — used by the self-check below

  if (adapter.SOURCE === 'licensing') {
    if (!file) { console.error('licensing source requires --file <export.csv>'); process.exit(1); }
    if (!fs.existsSync(file)) { console.error(`File not found: ${file}`); process.exit(1); }
    raw = adapter.parseListings(fs.readFileSync(file, 'utf8'));
    console.log(`  Ingested ${raw.length} rows from ${path.basename(file)}`);
  } else if (htmlFile) {
    // OFFLINE: parse a page you saved from the browser. Lets you validate the
    // parser on the Mac without a live fetch — if this yields 0, the selectors
    // (not the network) are the problem, and the saved file is what to send back.
    if (!fs.existsSync(htmlFile)) { console.error(`File not found: ${htmlFile}`); process.exit(1); }
    raw = adapter.parseListings(fs.readFileSync(htmlFile, 'utf8'));
    pagesFetchedOk = 1;
    console.log(`  Parsed ${raw.length} listings from saved file ${path.basename(htmlFile)} (offline)`);
  } else {
    const urls = adapter.buildSearchUrls(trade, city, { pages });
    const accept = adapter.SOURCE === 'bbb' ? 'application/json' : 'text/html,application/xhtml+xml';
    for (const url of urls) {
      try {
        const body = await dir.fetchBody(url, { accept });
        pagesFetchedOk++;
        if (saveHtml) {
          if (!fs.existsSync(saveHtml)) fs.mkdirSync(saveHtml, { recursive: true });
          const ext = adapter.SOURCE === 'bbb' ? 'json' : 'html';
          const dump = path.join(saveHtml, `${adapter.SOURCE}-page${pagesFetchedOk}.${ext}`);
          fs.writeFileSync(dump, body);
          console.log(`       saved raw page → ${dump}`);
        }
        const listings = adapter.parseListings(body);
        raw = raw.concat(listings);
        fetched++;
        console.log(`  page ${fetched}/${urls.length}: ${listings.length} listings`);
      } catch (e) {
        fetchErrors++;
        console.log(`  page ${fetched + fetchErrors}/${urls.length}: error (${e.message})`);
      }
      await sleep(1500); // polite delay between pages
    }
    if (fetchErrors === urls.length) {
      console.log('\n⚠  Every fetch failed. In the container this is expected (outbound proxy');
      console.log('   blocks arbitrary sites). Run this on the Mac for real results.');
      process.exit(1);
    }
  }

  // SELF-CHECK: pages came back (HTTP 200 / valid file) but parsed 0 listings.
  // That means the markup changed and the selectors need updating — surface it
  // LOUDLY instead of a silent "0 leads", and tell the user exactly what to do.
  if (pagesFetchedOk > 0 && raw.length === 0 && adapter.SOURCE !== 'licensing') {
    console.log('\n' + '!'.repeat(58));
    console.log('⚠  Pages loaded OK but 0 listings parsed — the site markup likely changed.');
    console.log('   This is a SELECTOR problem, not a network problem. To fix fast:');
    console.log(`     1. Re-run with --save-html /tmp/dsdump  to dump the raw page`);
    console.log(`     2. Or in a browser, save the ${adapter.SOURCE} results page and run:`);
    console.log(`          node scripts/directory-scout.js --source ${adapter.SOURCE} --trade ${trade} --city "${city}" --html <saved-file> --dry-run`);
    console.log(`     3. Send that saved file back so the adapter regex can be updated.`);
    console.log('!'.repeat(58));
    process.exit(2);
  }

  // ── dedup + format ──
  const knownIds     = dir.loadKnownIds();
  const knownDomains = dir.loadKnownDomains();
  const { leads, needsEmail, disc } = dir.dedupAndFormat(raw, {
    trade, city, source: adapter.SOURCE, knownIds, knownDomains,
  });

  const capped = leads.slice(0, limit);
  const withEmail = capped.filter(l => l.email).length;
  const withSite  = capped.filter(l => l.site_url && !l.email).length;

  console.log('─'.repeat(58));
  console.log(`  Raw listings:          ${raw.length}`);
  console.log(`  Usable leads:          ${capped.length}${capped.length < leads.length ? ` (capped from ${leads.length})` : ''}`);
  console.log(`    ├─ with email:       ${withEmail}   (feed email pipeline now)`);
  console.log(`    └─ with site only:   ${withSite}   (contact-scraper fills email)`);
  console.log(`  Needs manual email:    ${needsEmail.length}  (name/phone only → Apollo/manual)`);
  console.log(`  Duplicates skipped:    ${disc.duplicate}`);
  console.log(`  No name / unusable:    ${disc.noName}`);
  if (disc.platformOnly) console.log(`  Platform-only sites:   ${disc.platformOnly}  (fb/yelp stripped)`);
  console.log('─'.repeat(58));

  if (capped.length === 0 && needsEmail.length === 0) {
    console.log('No new leads. Try more --pages, a different city/trade, or another source.');
    return;
  }

  if (DRY_RUN) {
    console.log('\nWould write (dry run — nothing saved):');
    capped.slice(0, 10).forEach((l, i) =>
      console.log(`  ${i + 1}. ${l.business_name} — ${l.site_url || l.email || l.phone || '(no contact)'}`));
    if (capped.length > 10) console.log(`  … +${capped.length - 10} more`);
    return;
  }

  // ── persist ──
  if (capped.length > 0) {
    const { file: outFile, queued } = dir.writeLeadsAndQueue(capped, { source: adapter.SOURCE, city, trade });
    console.log(`\n✓ Wrote leads/${outFile}  (${queued} queued as 'scouted')`);
    if (WRITE_CSV) {
      const csvPath = path.join(dir.LEADS_WEB_DIR, outFile.replace(/\.json$/, '.csv'));
      if (!fs.existsSync(dir.LEADS_WEB_DIR)) fs.mkdirSync(dir.LEADS_WEB_DIR, { recursive: true });
      fs.writeFileSync(csvPath, dir.toCsv(capped));
      console.log(`✓ Wrote CSV: leads-web/${path.basename(csvPath)}`);
    }
  }
  const neFile = dir.writeNeedsEmailCsv(needsEmail, { source: adapter.SOURCE, city, trade });
  if (neFile) console.log(`✓ Wrote needs-email: leads-web/${neFile}`);

  // ── next-step guidance ──
  console.log('\nNext:');
  if (withSite > 0) console.log('  node scripts/contact-scraper.js      # fill emails from the new site_urls');
  console.log('  node scripts/diagnoser.js  →  node scripts/checker.js  →  node scripts/pitcher.js');
  if (needsEmail.length) console.log('  (needs-email CSV → Apollo enricher or manual lookup)');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
