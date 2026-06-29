#!/usr/bin/env node
/**
 * Contact-Page Scraper — zero-API-cost email discovery for has-website leads.
 *
 * Flips SMS-only leads into email-capable leads by visiting their website and
 * extracting a publicly visible email address. This is a FREE alternative to
 * Apollo (Enricher): no paid API, no credit cap — plain HTTP fetch + HTML parse.
 *
 * WHY this design (read before editing):
 *   In this codebase a lead's email does NOT live in state.json. It lives in the
 *   lead's record inside leads/*.json. Channel is NOT stored either — Diagnoser
 *   derives it at diagnose time: `channel = lead.email ? 'email' : (phone ? 'sms' ...)`
 *   (see scripts/diagnoser.js). So to make an SMS-only lead email-capable we:
 *     1. write the scraped email into that lead's leads/*.json record (fills the
 *        empty `email` field — additive, never overwrites an existing email), and
 *     2. reset the lead's state.json status to 'scouted' so Diagnoser re-runs and
 *        regenerates an email-appropriate brief (the SMS brief's cold_message is a
 *        ≤160-char SMS template, not an email — re-diagnosis is required).
 *   The prior status is preserved additively as `preScrapeStatus` so nothing is lost.
 *   This matches Dave's documented run order: scraper → Diagnoser → Checker → pitcher --channel email.
 *
 * Reads:  state.json            (finds leads not yet sent/closed)
 *         leads/*.json          (lead records: website/site_url, email)
 *         contractor websites   (live HTTP — run on Mac; container egress is proxy-gated)
 * Writes: leads/*.json          (fills empty `email` on flipped leads)
 *         state.json            (status -> 'scouted', adds preScrapeStatus, scrapedEmailAt)
 *
 * Usage:
 *   node scripts/contact-scraper.js              # real run
 *   node scripts/contact-scraper.js --dry-run    # find emails, write nothing
 *   node scripts/contact-scraper.js --limit 20   # cap sites visited this run
 *
 * NOTE: Must be run on the Mac for real results. The container's outbound proxy
 *   only allowlists package registries + Anthropic, so arbitrary contractor sites
 *   return 403 here (same reason Scout runs on Mac).
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');

// ── flags ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const LIMIT = parseInt(getArg('--limit'), 10) || Infinity;

// ── tunables ─────────────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 10000;   // per-request hard timeout
const DELAY_MS         = 1500;    // polite delay between sites
const SUBPAGE_DELAY_MS = 500;     // small delay between sub-pages of one site
const MAX_SUBPAGES     = 3;       // homepage + up to 3 contact-ish pages
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CONTACT_HINTS = ['contact', 'about', 'team', 'connect', 'get-in-touch'];
// states we will not disturb (already sent or done)
const SKIP_STATUSES = new Set(['sent', 'closed']);

// junk / placeholder domains that show up in template HTML, trackers, CDNs
const JUNK_NEEDLES = [
  'example.com', 'example.org', 'sentry', 'wix.com', 'wixpress', 'squarespace',
  'godaddy', 'domain.com', 'yourdomain', 'email.com', 'schema.org', 'w3.org',
  'googleapis', 'gstatic', 'cloudflare', 'cloudfront', 'jquery', 'bootstrapcdn',
  'fontawesome', 'wp.com', 'sentry.io', 'core.js', 'react', '.png@', '@2x',
];
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|eot|mp4|pdf)$/i;
const EMAIL_RE  = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ROLE_RE   = /^(info|contact|admin|office|sales|support|hello|service|help|team|billing|no-?reply|webmaster|mail)@/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function websiteOf(rec) { return rec.site_url || rec.website || rec.site || null; }

function normHost(url) {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : 'http://' + url);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch { return null; }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ct = res.headers.get('content-type') || '';
  if (!/html|text|xml/i.test(ct)) throw new Error('non-html (' + ct.split(';')[0] + ')');
  return await res.text();
}

function extractEmails(html) {
  const found = new Set();
  // 1) mailto: links (highest quality)
  const mailtoRe = /mailto:([^"'?>\s]+)/gi;
  let m;
  while ((m = mailtoRe.exec(html))) {
    try { found.add(decodeURIComponent(m[1]).trim().toLowerCase()); }
    catch { found.add(m[1].trim().toLowerCase()); }
  }
  // 2) plain-text addresses
  for (const e of (html.match(EMAIL_RE) || [])) found.add(e.trim().toLowerCase());
  return [...found];
}

function isJunk(email) {
  if (!email || email.length > 60) return true;
  if (ASSET_EXT.test(email)) return true;
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return true;
  if (JUNK_NEEDLES.some(n => email.includes(n))) return true;
  // sentry/analytics style hashed local-parts (long hex) — skip
  if (/^[0-9a-f]{16,}@/i.test(email)) return true;
  return false;
}

/** Pick the single best email: prefer site-domain match, then a personal address over a role address. */
function pickBest(emails, leadHost) {
  const clean = [...new Set(emails)].filter(e => !isJunk(e));
  if (clean.length === 0) return null;
  // Domain match must be exact or a real subdomain — substring matching would
  // mis-match e.g. host "abc.com" against an unrelated "noabc.com".
  const domMatch = leadHost ? clean.filter(e => {
    const d = (e.split('@')[1] || '').toLowerCase();
    return d === leadHost || d.endsWith('.' + leadHost);
  }) : [];
  const pool = domMatch.length ? domMatch : clean;
  const personal = pool.filter(e => !ROLE_RE.test(e));
  return (personal.length ? personal : pool)[0];
}

function findContactLinks(html, baseUrl) {
  const links = new Set();
  const aRe = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>(.*?)<\/a>/gis;
  let m;
  while ((m = aRe.exec(html))) {
    const href = m[1];
    const text = (m[2] || '').replace(/<[^>]+>/g, '');
    const hay = (href + ' ' + text).toLowerCase();
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) continue;
    if (CONTACT_HINTS.some(h => hay.includes(h))) {
      try { links.add(new URL(href, baseUrl).href); } catch { /* skip bad href */ }
    }
  }
  return [...links].filter(u => /^https?:/i.test(u)).slice(0, MAX_SUBPAGES);
}

/** Scrape one site → best email or null. Never throws (homepage failure returns null). */
async function scrapeSite(siteUrl) {
  const base = /^https?:/i.test(siteUrl) ? siteUrl : 'http://' + siteUrl;
  const host = normHost(base);
  let html;
  try {
    html = await fetchText(base);
  } catch (e) {
    // retry once over https if the bare/http attempt failed
    if (!/^https:/i.test(base)) {
      try { html = await fetchText(base.replace(/^http:/i, 'https:')); }
      catch (e2) { throw e; }
    } else { throw e; }
  }
  let emails = extractEmails(html);
  for (const sub of findContactLinks(html, base)) {
    try {
      const subHtml = await fetchText(sub);
      emails = emails.concat(extractEmails(subHtml));
    } catch { /* one bad sub-page never aborts the site */ }
    await sleep(SUBPAGE_DELAY_MS);
  }
  return pickBest(emails, host);
}

// ── lead index across leads/*.json ───────────────────────────────────────────
/** Build lead_id -> { file, idx } so we can write an email back into the right record. */
function buildLeadIndex() {
  const index = new Map();
  const files = fs.existsSync(LEADS_DIR) ? fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json')) : [];
  for (const file of files) {
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8')); }
    catch { continue; }
    if (!Array.isArray(arr)) continue;
    arr.forEach((rec, idx) => {
      if (rec && rec.lead_id && !index.has(rec.lead_id)) index.set(rec.lead_id, { file, idx });
    });
  }
  return index;
}

async function main() {
  console.log('\nContact-Page Scraper' + (DRY_RUN ? '  [DRY RUN — no writes]' : ''));
  console.log('─'.repeat(60));

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const leadIndex = buildLeadIndex();

  // Select candidates: in queue, not sent/closed, has a website, email empty,
  // and we can locate the underlying lead record to write to.
  const candidates = [];
  let noRecord = 0, noSite = 0, hasEmail = 0, skippedStatus = 0;
  for (const entry of state.queue) {
    if (SKIP_STATUSES.has(entry.status)) { skippedStatus++; continue; }
    const loc = leadIndex.get(entry.lead_id);
    if (!loc) { noRecord++; continue; }
    const arr = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, loc.file), 'utf8'));
    const rec = arr[loc.idx];
    if (rec.email && String(rec.email).trim()) { hasEmail++; continue; }
    const site = websiteOf(rec);
    if (!site) { noSite++; continue; }
    candidates.push({ entry, loc, rec, site });
  }

  console.log(`Queue: ${state.queue.length} leads`);
  console.log(`  skipped (sent/closed):     ${skippedStatus}`);
  console.log(`  already have email:        ${hasEmail}`);
  console.log(`  no website to scrape:      ${noSite}`);
  console.log(`  no lead record found:      ${noRecord}`);
  console.log(`  → eligible to scrape:      ${candidates.length}` + (LIMIT !== Infinity ? ` (capped at ${LIMIT})` : ''));
  console.log('─'.repeat(60));

  const todo = candidates.slice(0, LIMIT);
  let visited = 0, found = 0, flipped = 0, errors = 0;
  const flippedLeads = [];
  const errorLeads = [];
  // batch writes per leads file so we read/modify/write each file once
  const fileEdits = new Map(); // file -> array (mutated in place)

  for (const c of todo) {
    visited++;
    process.stdout.write(`[${visited}/${todo.length}] ${c.rec.business_name || c.entry.lead_id} … `);
    let email = null;
    try {
      email = await scrapeSite(c.site);
    } catch (e) {
      errors++;
      errorLeads.push({ lead_id: c.entry.lead_id, site: c.site, error: e.message });
      console.log(`error (${e.message})`);
      await sleep(DELAY_MS);
      continue;
    }
    if (!email) {
      console.log('no email found');
      await sleep(DELAY_MS);
      continue;
    }
    found++;
    flipped++;
    flippedLeads.push({ lead_id: c.entry.lead_id, business: c.rec.business_name, email, site: c.site });
    console.log(`✓ ${email}`);

    if (!DRY_RUN) {
      // 1) write email into the leads/*.json record (additive — fills empty field)
      if (!fileEdits.has(c.loc.file)) {
        fileEdits.set(c.loc.file, JSON.parse(fs.readFileSync(path.join(LEADS_DIR, c.loc.file), 'utf8')));
      }
      const arr = fileEdits.get(c.loc.file);
      if (!arr[c.loc.idx].email || !String(arr[c.loc.idx].email).trim()) {
        arr[c.loc.idx].email = email;
        arr[c.loc.idx].email_source = 'contact-scraper';
      }
      // 2) reset state so Diagnoser re-runs and derives channel=email (additive metadata)
      if (entryNeedsRediagnose(c.entry)) {
        c.entry.preScrapeStatus = c.entry.status;
        c.entry.status = 'scouted';
        c.entry.scrapedEmailAt = new Date().toISOString();
      }
    }
    await sleep(DELAY_MS);
  }

  if (!DRY_RUN && flipped > 0) {
    for (const [file, arr] of fileEdits) {
      fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(arr, null, 2));
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(60));
  console.log('Summary');
  console.log(`  sites visited:        ${visited}`);
  console.log(`  emails found:         ${found}`);
  console.log(`  leads flipped→email:  ${DRY_RUN ? 0 : flipped}${DRY_RUN ? `  (${flipped} would flip)` : ''}`);
  console.log(`  no email / unchanged: ${visited - found}`);
  console.log(`  fetch errors:         ${errors}`);
  if (flippedLeads.length) {
    console.log('\nFlipped to email:');
    for (const f of flippedLeads) console.log(`  • ${f.business || f.lead_id} → ${f.email}`);
  }
  if (!DRY_RUN && flipped > 0) {
    console.log('\nNext: node scripts/diagnoser.js  →  node scripts/checker.js  →  node scripts/pitcher.js --channel email');
  }
  if (errors === visited && visited > 0) {
    console.log('\n⚠  Every fetch errored. If you are in the container, that is expected (outbound');
    console.log('   proxy blocks arbitrary sites). Run this on the Mac for real results.');
  }
}

/** Only rewind leads that are mid-funnel (not already sent/closed). Sent/closed were filtered out earlier. */
function entryNeedsRediagnose(entry) {
  return !SKIP_STATUSES.has(entry.status);
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

// Exported for unit testing (pure functions only — no I/O).
module.exports = { extractEmails, isJunk, pickBest, findContactLinks, normHost, websiteOf };
