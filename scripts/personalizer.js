#!/usr/bin/env node
/**
 * Personalizer — generates a personalized demo URL for each checker-approved lead
 *
 * The URL points to /for/?b=...&t=...&c=...&r=... which renders a branded
 * landing page with the appropriate trade demo iframe + buy CTA.
 *
 * Usage:
 *   node scripts/personalizer.js           (preview all, write nothing)
 *   node scripts/personalizer.js --write   (write demo_url to briefs)
 *   node scripts/personalizer.js --force   (overwrite existing demo_url fields)
 *
 * Reads:  queue/*-brief.json  (checker_approved = true)
 * Writes: queue/*-brief.json  (adds demo_url, demo_url_created_at)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs   = require('fs');
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'queue');

const args    = process.argv.slice(2);
const doWrite = args.includes('--write') || args.includes('--force');
const doForce = args.includes('--force');

// Base URL — reads SITE_START_URL if set, derives /for/ from it
function baseUrl() {
  const start = process.env.SITE_START_URL || 'https://trevoadvisors.com/start/';
  return start.replace(/\/start\/?$/, '/for/');
}

// Normalize trade to a consistent slug
function normalizeTrade(raw) {
  const t = (raw || '').toLowerCase().trim();
  const MAP = {
    plumbers:    'plumber',
    plumbing:    'plumber',
    hvac:        'hvac',
    electricians:'electrician',
    electrical:  'electrician',
    roofers:     'roofer',
    roofing:     'roofer',
    handymen:    'handyman',
    handyman:    'handyman',
  };
  return MAP[t] || t;
}

function buildDemoUrl(brief) {
  const params = new URLSearchParams();
  if (brief.business_name) params.set('b', brief.business_name);
  params.set('t', normalizeTrade(brief.trade));
  const city = (brief.city || '').replace(/,\s*[A-Z]{2}$/, '').trim();
  if (city) params.set('c', city);
  if (brief.review_count) params.set('r', String(brief.review_count));
  return `${baseUrl()}?${params.toString()}`;
}

function main() {
  console.log(`\nPersonalizer${doWrite ? '' : ' [preview only — use --write to save]'}`);
  console.log('─'.repeat(50));

  if (!fs.existsSync(QUEUE_DIR)) {
    console.log('No queue/ directory found.');
    return;
  }

  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  if (files.length === 0) {
    console.log('No briefs in queue/. Run Diagnoser and Checker first.');
    return;
  }

  let previewed = 0, written = 0, skipped = 0;

  for (const file of files) {
    try {
      const briefPath = path.join(QUEUE_DIR, file);
      const brief     = JSON.parse(fs.readFileSync(briefPath, 'utf8'));

      if (!brief.checker_approved) { skipped++; continue; }
      if (brief.demo_url && !doForce) { skipped++; continue; }

      const demoUrl = buildDemoUrl(brief);

      if (doWrite) {
        brief.demo_url            = demoUrl;
        brief.demo_url_created_at = new Date().toISOString();
        fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
        console.log(`✓  ${(brief.business_name || file).padEnd(32)}  ${demoUrl}`);
        written++;
      } else {
        console.log(`   ${(brief.business_name || file).padEnd(32)}  ${demoUrl}`);
        previewed++;
      }
    } catch (e) {
      console.warn(`Error processing ${file}: ${e.message}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  if (doWrite) {
    console.log(`Done.  Written: ${written}  Skipped: ${skipped}`);
    console.log('\nNext: node scripts/pitcher.js --force');
  } else {
    console.log(`Preview: ${previewed} URLs  (${skipped} skipped — not approved or already set)`);
    console.log('\nRun with --write to save URLs to briefs.');
  }
}

main();
