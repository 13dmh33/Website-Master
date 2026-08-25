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
//   node miley/scripts/scrape-catalog.js                 # fetch live store, DRY RUN (prints what it found)
//   node miley/scripts/scrape-catalog.js --write         # fetch live store, then update both files
//   node miley/scripts/scrape-catalog.js --sitemap       # skip the HTML entirely, read sitemap.xml
//   node miley/scripts/scrape-catalog.js --render        # render JS first (needs puppeteer — see below)
//   node miley/scripts/scrape-catalog.js --html page.html        # parse a saved page instead of fetching
//   node miley/scripts/scrape-catalog.js --from "Unisex Tee, Snapback Hat"   # use a pasted comma list
//
// Printify pop-up stores render their product grid client-side, so a plain
// fetch returns a shell with no product data in it — that is the normal case
// here, not an error and not a block. The default run therefore falls back to
// the store's own sitemap.xml, which is server-generated, lists every product
// page, and costs one request. --sitemap forces that path directly.
//
// --render remains for a store whose sitemap is missing or incomplete. It
// launches real headless Chrome and reads the DOM after hydration — reliable,
// but a one-time ~300MB Chromium download:
//   npm install --no-save puppeteer
//   node miley/scripts/scrape-catalog.js --render --write
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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

// ── sitemap strategy ────────────────────────────────────────────────────────
// The storefront is a client-rendered Next.js app: the product grid is fetched
// after hydration, so the served HTML genuinely contains no product data and
// every strategy above correctly finds nothing. The sitemap is server-generated
// and lists every product page, which makes it the reliable source here — one
// request, no headless browser, no 300MB Chromium download.
//
// Verified 2026-08-13: techs4tatas.printify.me returns HTTP 200 to both a
// browser UA and plain curl — there is no anti-bot block — and its sitemap
// enumerates the full catalogue, matching the product mockup ids in the HTML.
const SITEMAP_PRODUCT_RE = /\/product\/(\d+)\/([a-z0-9-]+)/gi;

async function fetchSitemapNames(storefront) {
  const url = `${storefront}/sitemap.xml`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const xml = await res.text();

  const names = [];
  const seenIds = new Set();
  let m;
  SITEMAP_PRODUCT_RE.lastIndex = 0;
  while ((m = SITEMAP_PRODUCT_RE.exec(xml))) {
    const id = m[1];
    if (seenIds.has(id)) continue; // a sitemap may list the same product twice
    seenIds.add(id);
    names.push(titleFromSlug(m[2]));
  }
  return names;
}

// "techs-4-tatas-pocket-and-amp-back-graphic-tee"
//   → "Techs 4 Tatas Pocket & Back Graphic Tee"
// The store slugifies "&" as "and-amp" (an HTML-escaped "&amp;" run through
// the slugger), so that has to come back out before word-splitting.
function titleFromSlug(slug) {
  return String(slug)
    .replace(/-and-amp-/g, ' & ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bT Shirt\b/g, 'T-Shirt');
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

// Reads the PRODUCTS map already in lib/links.js, so a run can say what would
// actually change rather than just what it found.
function readExistingCatalog() {
  try {
    const src = fs.readFileSync(LINKS_FILE, 'utf8');
    const block = /const PRODUCTS = \{([\s\S]*?)\n\};/.exec(src);
    if (!block) return [];
    const out = [];
    const re = /^\s*([a-z0-9_]+)\s*:\s*(['"])([\s\S]*?)\2\s*,?\s*$/gm;
    let m;
    while ((m = re.exec(block[1]))) out.push({ key: m[1], name: m[3] });
    return out;
  } catch (_) {
    return [];
  }
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
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
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
  const SITEMAP  = args.includes('--sitemap');

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
  } else if (SITEMAP) {
    console.log(`Reading ${STOREFRONT}/sitemap.xml …`);
    names = await fetchSitemapNames(STOREFRONT);
    source = 'live store sitemap.xml';
  } else {
    console.log(`Fetching ${STOREFRONT} …`);
    const html = await fetchHtml(STOREFRONT);
    const r = extractProductNames(html);
    names = r.names; source = `live store via ${r.strategy || 'no match'}`;
    if (!names.length) {
      // Expected, not a failure: this storefront renders its grid client-side,
      // so there is nothing in the served HTML to find. Fall through to the
      // sitemap rather than sending anyone off to install a headless browser.
      console.log('  Nothing in the served HTML (client-rendered) — reading sitemap.xml …');
      names = await fetchSitemapNames(STOREFRONT);
      source = 'live store sitemap.xml';
    }
  }

  if (!names.length) {
    console.error('\n✗ No products found.');
    console.error('  Neither the served HTML nor sitemap.xml listed any products.');
    console.error('  Workarounds:');
    console.error('   • Render it in a real browser: npm install --no-save puppeteer && node miley/scripts/scrape-catalog.js --render --write');
    console.error('   • Save the page (or its source) and pass: --html page.html');
    console.error('   • Or paste the names:  --from "Unisex Tee, Snapback Hat, …"');
    process.exit(1);
  }

  const catalog = toCatalog(names);

  console.log(`\nFound ${catalog.length} products (${source}):\n`);
  for (const p of catalog) console.log(`  ${p.key.padEnd(28)} ${p.name}`);

  // Say what would actually change, not just what was found — the useful
  // question is drift, and the answer is usually "none".
  const existing = readExistingCatalog();
  if (existing.length) {
    console.log(`\nCurrent catalog in lib/links.js: ${existing.length} products.`);
    if (existing.length === catalog.length) {
      console.log('Same count as the live store — no products added or removed.');
    } else {
      console.log(`Count differs: repo has ${existing.length}, store has ${catalog.length} — real drift, worth writing.`);
    }
  }

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to update:');
    console.log('  • lib/links.js  (PRODUCTS map)');
    console.log('  • templates/post-formats.json  (product_catalog_rotation)');
    return;
  }

  // Sitemap names are derived from URL slugs, so they are verbose
  // ("Unisex Black T-Shirt Techs 4 Tatas") where a hand-written catalog is
  // usually terser and better for captions ("Unisex Tee"). Overwriting an
  // existing catalog that already has the right number of products would be a
  // downgrade with no gain, so that case has to be asked for explicitly.
  if (source.includes('sitemap') && existing.length === catalog.length && !args.includes('--force')) {
    console.error('\n✗ Refusing to overwrite: the catalog already has the same number of products,');
    console.error('  and sitemap names are slug-derived — this would replace curated display');
    console.error('  names with longer ones for no gain.');
    // Listed separately, not paired: the two lists are in different orders, so
    // showing them as arrows would invent renames that aren't real.
    console.error(`\n  Curated now:      ${existing.map((p) => p.name).join(', ')}`);
    console.error(`  Would become:     ${catalog.map((p) => p.name).join(', ')}`);
    console.error('\n  Pass --force if that is genuinely what you want.');
    process.exit(1);
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
