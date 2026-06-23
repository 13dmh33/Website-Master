'use strict';

// scrape-catalog.js — pull the REAL product list from the Techs4Tatas Printify
// storefront and sync it into the engine.
//
// Why a script (not a one-off): the Printify storefront host is blocked by the
// Claude container's network egress allowlist, so this — like Scout/Pitcher in
// Trevo — must run where the network is open: your Mac, or the GitHub Action
// runner. It rewrites two sources of truth so the funnel always reflects the
// actual catalog:
//   • lib/links.js            → PRODUCTS  (catalog key → display name)
//   • templates/post-formats.json → product_catalog_rotation (ordered keys)
//
// Usage:
//   node scripts/scrape-catalog.js                 # fetch live store, DRY RUN (prints what it found)
//   node scripts/scrape-catalog.js --write         # fetch live store, then update both files
//   node scripts/scrape-catalog.js --render        # like above, but render JS first (needs puppeteer — see below)
//   node scripts/scrape-catalog.js --html page.html        # parse a saved page instead of fetching
//   node scripts/scrape-catalog.js --from "Unisex Tee, Snapback Hat"   # use a pasted comma list
//   node scripts/scrape-catalog.js --from "..." --write
//
// Printify pop-up stores render their product grid client-side, so a plain
// fetch often returns an empty shell. --render launches a real headless
// browser (Puppeteer) and reads the DOM after it loads — the most reliable
// option, but it's a one-time ~300MB Chromium download:
//   npm install --no-save puppeteer
//   node scripts/scrape-catalog.js --render --write
//
// Env: STOREFRONT_URL (defaults to techs4tatas.printify.me).

const fs   = require('fs');
const path = require('path');
require('dotenv').config();

let fetchFn = global.fetch;
try { if (!fetchFn) fetchFn = require('node-fetch'); } catch (_) { /* node18+ has global fetch */ }

const ROOT          = path.join(__dirname, '..');
const LINKS_FILE    = path.join(ROOT, 'lib', 'links.js');
const FORMATS_FILE  = path.join(ROOT, 'templates', 'post-formats.json');

const args  = process.argv.slice(2);
const WRITE = args.includes('--write');
const flag  = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const STOREFRONT = normalizeUrl(process.env.STOREFRONT_URL || 'techs4tatas.printify.me');

function normalizeUrl(u) {
  const t = String(u || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

// "Pocket & Back Graphic Tee" → "pocket_back_graphic_tee"
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

// dedupe keys: a second "Kiss-Cut Sticker" becomes kiss_cut_sticker_2
function toCatalog(names) {
  const seen = new Map();
  const catalog = [];
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    let key = slugify(name);
    if (!key) continue;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) key = `${key}_${n}`;
    catalog.push({ key, name });
  }
  return catalog;
}

// ── product extraction ──────────────────────────────────────────────────────
// Printify pop-up stores can render product data a few different ways, so try
// several strategies in priority order and return the first non-empty result.
function extractProductNames(html) {
  const tried = [];

  // 1) JSON-LD Product schema (most reliable when present)
  const ldNames = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      const nodes = Array.isArray(json) ? json : (json['@graph'] || [json]);
      for (const node of nodes) {
        if (node && /product/i.test(node['@type'] || '') && node.name) ldNames.push(node.name);
      }
    } catch (_) { /* ignore malformed block */ }
  }
  tried.push(['JSON-LD', ldNames]);

  // 2) embedded state blobs — Next.js (__NEXT_DATA__, app-router streaming via
  // self.__next_f.push), Nuxt, Redux, Remix — grab "title"/"name" inside any
  // of them. These ship the product list as JSON even when the visible DOM
  // is still an empty shell pre-hydration.
  const stateNames = [];
  const hasEmbeddedState = /__NEXT_DATA__|__INITIAL_STATE__|__NUXT__|self\.__next_f|__remixContext/.test(html);
  if (hasEmbeddedState) {
    const titleRe = /"(?:title|name|productTitle)"\s*:\s*"((?:[^"\\]|\\.){2,120})"/g;
    let t;
    while ((t = titleRe.exec(html))) {
      const v = t[1].replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\n/g, ' ').trim();
      if (v && !/^https?:/i.test(v) && !/^\d+(\.\d+)?$/.test(v)) stateNames.push(v);
    }
  }
  tried.push(['embedded-state', dedupePreserveOrder(stateNames)]);

  // 3) product card markup fallback: anchors/cards with a product title attr/class
  const cardNames = [];
  const cardRe = /(?:data-product-title|product[-_]?title["'][^>]*)>?\s*([^<"']{2,120})/gi;
  let c;
  while ((c = cardRe.exec(html))) {
    const v = c[1].trim();
    if (v) cardNames.push(v);
  }
  tried.push(['product-cards', dedupePreserveOrder(cardNames)]);

  for (const [strategy, names] of tried) {
    if (names && names.length) return { strategy, names: dedupePreserveOrder(names) };
  }
  return { strategy: null, names: [] };
}

function dedupePreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// ── file rewrites ───────────────────────────────────────────────────────────
function rewriteLinks(catalog) {
  let src = fs.readFileSync(LINKS_FILE, 'utf8');
  const pad = Math.max(...catalog.map((p) => p.key.length)) + 1;
  const body = catalog
    .map((p) => `  ${(p.key + ':').padEnd(pad + 1)} ${JSON.stringify(p.name)},`)
    .join('\n');
  const block = `const PRODUCTS = {\n${body}\n};`;
  const re = /const PRODUCTS = \{[\s\S]*?\n\};/;
  if (!re.test(src)) throw new Error('Could not find the PRODUCTS block in lib/links.js');
  src = src.replace(re, block);
  fs.writeFileSync(LINKS_FILE, src);
}

function rewriteFormats(catalog) {
  const data = JSON.parse(fs.readFileSync(FORMATS_FILE, 'utf8'));
  data.product_catalog_rotation = catalog.map((p) => p.key);
  fs.writeFileSync(FORMATS_FILE, JSON.stringify(data, null, 2) + '\n');
}

// ── main ────────────────────────────────────────────────────────────────────
async function fetchHtml(url) {
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// renders the page in a real headless browser and reads the DOM after JS
// runs — handles stores that fetch their product list via XHR with nothing
// embedded in the initial HTML at all.
async function fetchRenderedHtml(url) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    throw new Error(
      'puppeteer is not installed. Run: npm install --no-save puppeteer\n' +
      '  (one-time ~300MB Chromium download, then re-run with --render)'
    );
  }
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // give lazy-loaded product grids a moment past the network-idle event
    await new Promise((r) => setTimeout(r, 1500));
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function main() {
  let names = [];
  let source = '';

  const fromList = flag('--from');
  const htmlFile = flag('--html');
  const RENDER   = args.includes('--render');

  if (fromList) {
    names = fromList.split(/\s*[,\n]\s*/).filter(Boolean);
    source = 'pasted --from list';
  } else if (htmlFile) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const r = extractProductNames(html);
    names = r.names; source = `saved file (${htmlFile}) via ${r.strategy || 'no match'}`;
  } else if (RENDER) {
    console.log(`Rendering ${STOREFRONT} in headless Chrome …`);
    const html = await fetchRenderedHtml(STOREFRONT);
    const r = extractProductNames(html);
    names = r.names; source = `rendered store via ${r.strategy || 'no match'}`;
  } else {
    console.log(`Fetching ${STOREFRONT} …`);
    const html = await fetchHtml(STOREFRONT);
    const r = extractProductNames(html);
    names = r.names; source = `live store via ${r.strategy || 'no match'}`;
  }

  if (!names.length) {
    console.error('\n✗ No products found.');
    console.error('  The store may render via JS the parser did not catch.');
    console.error('  Workarounds:');
    console.error('   • Render it in a real browser: npm install --no-save puppeteer && node scripts/scrape-catalog.js --render --write');
    console.error('   • Save the page (or its source) and pass: --html page.html');
    console.error('   • Or paste the names:  --from "Unisex Tee, Snapback Hat, …"');
    process.exit(1);
  }

  const catalog = toCatalog(names);

  console.log(`\nFound ${catalog.length} products (${source}):\n`);
  for (const p of catalog) console.log(`  ${p.key.padEnd(28)} ${p.name}`);

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to update:');
    console.log('  • lib/links.js  (PRODUCTS map)');
    console.log('  • templates/post-formats.json  (product_catalog_rotation)');
    return;
  }

  rewriteLinks(catalog);
  rewriteFormats(catalog);
  console.log('\n✓ Wrote lib/links.js (PRODUCTS) and templates/post-formats.json (product_catalog_rotation).');
  console.log('  Next: node scripts/build-linkpage.js  → refresh the link-in-bio hub.');
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
