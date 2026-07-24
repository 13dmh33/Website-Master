#!/usr/bin/env node
/**
 * Diagnostic — dumps what Outscraper ACTUALLY returns for a query, so we can
 * see whether the `site` / `email` fields are populated or empty. Answers
 * "the businesses have websites on Google, why is Scout finding none?" by
 * showing the raw Maps/GBP data Scout filters on.
 *
 * Usage (on Mac — Outscraper blocks the container):
 *   node scripts/debug-outscraper.js "plumber" "Austin, TX"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const https = require('https');

const trade = process.argv[2] || 'plumber';
const city  = process.argv[3] || 'Austin, TX';
const apiKey = process.env.OUTSCRAPER_API_KEY;
if (!apiKey) { console.error('OUTSCRAPER_API_KEY missing from .env.local'); process.exit(1); }

const PLATFORM = /facebook\.com|instagram\.com|yelp\.com|nextdoor\.com|thumbtack\.com|linktr\.ee|linktree\.com|g\.page|business\.google\.com|maps\.google\.com|goo\.gl\/maps|m\.me\//i;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.app.outscraper.com', path, method: 'GET', headers: { 'X-API-KEY': apiKey } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d)); } }); });
    req.on('error', reject); req.end();
  });
}

async function poll(loc) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const u = new URL(loc);
    const res = await get(u.pathname + u.search);
    if (res.status === 'Success') return res.data?.[0] || res.data || [];
    process.stdout.write('.');
  }
  throw new Error('timed out polling');
}

(async () => {
  // NO `fields` param this time — get Outscraper's full default object so we can
  // see every key and find where the website actually lives.
  const params = new URLSearchParams({
    query: `${trade} in ${city}`, limit: '25', language: 'en', region: 'us'
  });
  console.log(`Query: "${trade} in ${city}"  — calling /maps/search-v3 with NO field filter ...`);
  let raw = await get(`/maps/search-v3?${params}`);
  let rows = (raw.status === 'Success' && raw.data) ? raw.data : (raw.id ? await poll(raw.results_location) : null);
  if (!Array.isArray(rows) || rows.length === 0) { console.error('Unexpected response:', JSON.stringify(raw).slice(0, 600)); process.exit(1); }

  const first = rows[0];
  console.log(`\n=== ALL KEYS on the first result (${first.name}) ===`);
  console.log(Object.keys(first).join(', '));

  // Look for the website under every plausible key name.
  const WEBSITE_KEYS = ['site', 'website', 'site_url', 'url', 'domain', 'web', 'homepage'];
  const EMAIL_KEYS = ['email', 'email_1', 'emails', 'email_address'];
  console.log(`\n=== website-ish + email-ish fields on first result ===`);
  for (const k of WEBSITE_KEYS) if (k in first) console.log(`  ${k}: ${JSON.stringify(first[k])}`);
  for (const k of EMAIL_KEYS) if (k in first) console.log(`  ${k}: ${JSON.stringify(first[k])}`);

  console.log(`\n=== FULL first result object ===`);
  console.log(JSON.stringify(first, null, 2).slice(0, 2500));

  // Now count populated website across the batch under whichever key exists.
  const siteKey = WEBSITE_KEYS.find(k => rows.some(r => r[k]));
  console.log(`\n=== which key actually carries a website? -> ${siteKey || 'NONE FOUND'} ===`);
  if (siteKey) {
    const populated = rows.filter(r => r[siteKey] && String(r[siteKey]).trim()).length;
    console.log(`  ${populated} of ${rows.length} results have a value under '${siteKey}'`);
    rows.slice(0, 12).forEach(r => console.log(`    ${(r.name||'').slice(0,32).padEnd(32)} | ${r[siteKey] || '—'}`));
  }
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
