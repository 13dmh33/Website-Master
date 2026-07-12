#!/usr/bin/env node
/**
 * Directory Scraper — trade-directory enrichment + social capture (Scout → here → Enricher).
 *
 * A NEW, ISOLATED enrichment agent. It looks each lead up on trade directories
 * (BBB today; Yelp is phase 2, see below), matches the profile back to the lead,
 * and pulls contact fields (phone, email, website) + social links (facebook,
 * instagram, linkedin, twitter/x, youtube, tiktok, …). Free contact data BEFORE
 * the paid Enricher (Apollo) runs — "free before paid holds".
 *
 * PIPELINE INTEGRITY (read before editing):
 *   • Zero modification to Scout, Enricher, or Contact Scraper. This file stands alone.
 *   • Socials/contact come out of the ONE shared extractor: scripts/lib/social-extractor.js
 *     (the same module the contact-scraper --deep crawl uses).
 *   • All writes are ADDITIVE (fill-if-empty) into the SAME lead-record fields the rest
 *     of the pipeline already uses (leads/*.json): email, phone, website, contact_name,
 *     socials. Nothing is ever overwritten. Re-diagnosis is triggered ONLY when a NEW
 *     email is found (phone/name/socials alone never rewind a lead's status) — identical
 *     to the contact-scraper contract, because Diagnoser derives channel from lead.email.
 *   • state.json gets additive metadata only: directorySource, directoryProfiles[],
 *     directoryEnrichedAt (+ the standard preScrapeStatus/scrapedEmailAt on an email flip).
 *   • The Google Sheet is NOT written here — socials reach the CRM via the next
 *     `node scripts/sheet-log.js` run (single Sheet writer, no rebuild/append conflict).
 *
 * MATCHING (the hard part — wrong-business contamination is the main risk):
 *   A directory profile is accepted only if it matches the lead on ≥ 2 of 3 signals —
 *   business name (token overlap), city, phone. Confidence = matchedSignals / 3 is logged.
 *   Below threshold → the lead is SKIPPED. Never guess.
 *
 * DIRECTORY TARGETS (ranked by scrape-ability):
 *   1. BBB   — static-ish HTML + JSON-LD; has phone/website/socials.  ✅ implemented
 *   2. Yelp  — heavy anti-bot, needs Playwright.  ⏳ phase 2 (stub — skipped with a note)
 *   3. Angi/HomeAdvisor — login walls on contact data.  ✗ skipped by design
 *   4. State/trade association rosters — clean but per-site; pairs with a DORA scraper later.
 *
 * GUARDRAILS:
 *   • Dry-run is the DEFAULT. Pass --live (or DIRECTORY_LIVE=1) to actually write.
 *   • Polite crawler: 1 request / 3–5s per domain, rotating User-Agent, 10s timeout.
 *   • Optional Playwright/Chromium headless render for anti-bot search pages
 *     (graceful skip if `playwright` isn't installed; disable with --no-render).
 *
 * Usage:
 *   node scripts/directory-scraper.js                 # DRY RUN — logs what it would write
 *   node scripts/directory-scraper.js --live          # write enrichment to leads/ + state.json
 *   node scripts/directory-scraper.js --limit 20      # cap leads processed this run
 *   node scripts/directory-scraper.js --source bbb    # directory to use (default bbb; yelp = phase 2)
 *   node scripts/directory-scraper.js --min-confidence 3   # require all 3 signals (stricter)
 *   node scripts/directory-scraper.js --no-render     # disable the JS/anti-bot render fallback
 *
 * NOTE: Run on the Mac for real results. The container's outbound proxy blocks BBB
 *   (same reason Scout runs on Mac); every fetch will error here. The render fallback
 *   needs `playwright` installed (npm i playwright); without it, static HTML is used.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const se   = require('./lib/social-extractor');

const ROOT       = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');

// ── flags ─────────────────────────────────────────────────────────────────────
function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const LIVE   = process.argv.includes('--live') || process.env.DIRECTORY_LIVE === '1';
const RENDER = !process.argv.includes('--no-render');
const LIMIT  = parseInt(getArg('--limit'), 10) || Infinity;
const SOURCE = (getArg('--source') || 'bbb').toLowerCase();
const MIN_CONFIDENCE = Math.max(1, Math.min(3, parseInt(getArg('--min-confidence'), 10) || 2)); // signals out of 3

// ── tunables ────────────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 10000;
const RATE_MIN_MS      = 3000;   // 1 request / 3–5s per domain (randomized)
const RATE_MAX_MS      = 5000;
const MAX_CANDIDATES   = 5;      // profiles to open per lead before giving up
const SKIP_STATUSES    = new Set(['sent', 'closed']);
// Rotating User-Agents (polite crawler, looks like a normal browser).
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasVal = v => v && String(v).trim();

// ═══════════════════════════════════════════════════════════════════════════════
// PURE LOGIC (no I/O) — exported for tests
// ═══════════════════════════════════════════════════════════════════════════════

// Words that carry no identity for a contractor business name — dropped before match.
const NAME_STOPWORDS = new Set([
  'the', 'and', 'of', 'a', 'llc', 'inc', 'incorporated', 'co', 'company', 'corp',
  'services', 'service', 'group', 'solutions', 'pros', 'pro', 'experts', 'expert',
  'plumbing', 'plumber', 'plumbers', 'electric', 'electrical', 'electrician', 'electricians',
  'handyman', 'handymen', 'roofing', 'roofer', 'roofers', 'heating', 'cooling', 'air',
  'contractor', 'contractors', 'construction', 'home', 'repair', 'repairs', 'maintenance',
]);

/** Significant, order-independent tokens of a business name (stopwords/punct stripped). */
function nameTokens(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip accents
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t && t.length > 1 && !NAME_STOPWORDS.has(t))
  );
}

/** True if two business names share enough identity (Jaccard-ish overlap ≥ 0.5, or subset). */
function nameMatch(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter === 0) return false;
  const smaller = Math.min(ta.size, tb.size);
  const union = ta.size + tb.size - inter;
  return inter / smaller >= 0.6 || inter / union >= 0.5;
}

/** "Aurora, CO" / "Aurora CO" / {city,state} → { city, state } (lowercased, best-effort). */
function cityState(input, stateHint) {
  if (input && typeof input === 'object') {
    return { city: String(input.city || '').trim().toLowerCase(), state: String(input.state || stateHint || '').trim().toLowerCase() };
  }
  const s = String(input || '').trim();
  const m = s.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
  if (m) return { city: m[1].trim().toLowerCase(), state: m[2].trim().toLowerCase() };
  return { city: s.toLowerCase(), state: String(stateHint || '').trim().toLowerCase() };
}

/** City match: same city name, and states agree when both are known. */
function cityMatch(leadCity, profCity, profState) {
  const a = cityState(leadCity);
  const b = cityState(profCity, profState);
  if (!a.city || !b.city) return false;
  if (a.city !== b.city) return false;
  if (a.state && b.state && a.state !== b.state) return false;
  return true;
}

/** Phone match on normalized US numbers. */
function phoneMatch(a, b) {
  const na = se.normalizePhone(a), nb = se.normalizePhone(b);
  return !!na && na === nb;
}

/**
 * Score a candidate directory profile against the lead on 3 signals.
 * @returns {{ score:number, confidence:number, matched:{name,city,phone}, accepted:boolean }}
 */
function scoreMatch(lead, profile, minConfidence = MIN_CONFIDENCE) {
  const matched = {
    name:  nameMatch(lead.business_name, profile.name),
    city:  cityMatch(lead.city, profile.city, profile.state),
    phone: phoneMatch(lead.phone, profile.phone),
  };
  const score = (matched.name ? 1 : 0) + (matched.city ? 1 : 0) + (matched.phone ? 1 : 0);
  return { score, confidence: score / 3, matched, accepted: score >= minConfidence };
}

// ── BBB parsers (pure) ────────────────────────────────────────────────────────

/** BBB search API URL for a lead (JSON endpoint — most reliable when reachable). */
function buildBbbApiUrl(lead) {
  const { city, state } = cityState(lead.city);
  const loc = [city, state].filter(Boolean).join(', ');
  const q = new URLSearchParams({
    find_country: 'USA',
    find_text: lead.business_name || '',
    find_loc: loc,
    page: '1',
    pageSize: '10',
    sort: 'Relevance',
  });
  return `https://www.bbb.org/api/search?${q.toString()}`;
}

/** BBB human search URL (HTML fallback / render target). */
function buildBbbSearchUrl(lead) {
  const { city, state } = cityState(lead.city);
  const loc = [city, state].filter(Boolean).join(', ');
  const q = new URLSearchParams({ find_country: 'USA', find_text: lead.business_name || '', find_loc: loc });
  return `https://www.bbb.org/search?${q.toString()}`;
}

/** Parse the BBB search JSON API into candidate {name,url,phone,city,state}. Tolerant of shape drift. */
function parseBbbSearchJson(json) {
  let data = json;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return []; } }
  const results = data?.results || data?.searchResults || data?.businesses || data?.SearchResults || [];
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    const name = r.businessName || r.name || r.BusinessName || r.title;
    let url = r.reportUrl || r.profileUrl || r.url || r.reportURL || r.link;
    if (url && !/^https?:/i.test(url)) url = 'https://www.bbb.org' + (url.startsWith('/') ? '' : '/') + url;
    const phone = r.phone || r.telephone || (Array.isArray(r.phones) ? r.phones[0] : null);
    const addr = r.address || r.location || {};
    const city = r.city || addr.city || addr.addressLocality || null;
    const state = r.state || r.stateProvince || addr.state || addr.addressRegion || null;
    if (name || url) out.push({ name: name || null, url: url || null, phone: phone || null, city, state });
  }
  return out;
}

/** Parse candidate profile links out of a BBB search results HTML page (fallback). */
function parseBbbSearchHtml(html) {
  const out = [];
  const seen = new Set();
  const aRe = /<a\b[^>]*?href\s*=\s*["']([^"']*\/profile\/[^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html))) {
    let url = m[1];
    if (!/^https?:/i.test(url)) url = 'https://www.bbb.org' + (url.startsWith('/') ? '' : '/') + url;
    if (seen.has(url)) continue;
    seen.add(url);
    const name = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    out.push({ name, url, phone: null, city: null, state: null });
  }
  return out;
}

/** Business identity fields from a BBB profile's JSON-LD (name/website/phone/email/city/state). */
function readBusinessJsonLd(html) {
  const out = { name: null, phone: null, website: null, city: null, state: null, email: null };
  const seen = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (seen.has(node)) return; seen.add(node);
    const types = [].concat(node['@type'] || []).map(t => String(t).toLowerCase());
    const isBiz = types.some(t => /(localbusiness|business|organization|store|contractor|professionalservice|homeandconstruction)/.test(t));
    if (isBiz) {
      if (!out.name && typeof node.name === 'string') out.name = node.name.trim();
      if (!out.website && typeof node.url === 'string' && /^https?:/i.test(node.url) && !/bbb\.org/i.test(node.url)) out.website = node.url.trim();
      if (!out.phone && typeof node.telephone === 'string') out.phone = se.normalizePhone(node.telephone);
      if (!out.email && typeof node.email === 'string') out.email = node.email.replace(/^mailto:/i, '').trim().toLowerCase();
      const addr = node.address;
      if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
        if (!out.city && addr.addressLocality) out.city = String(addr.addressLocality).trim();
        if (!out.state && addr.addressRegion) out.state = String(addr.addressRegion).trim();
      }
    }
    for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') visit(node[k]);
  };
  se.extractJsonLd(html).forEach(visit);
  return out;
}

/**
 * Parse a BBB business profile page → normalized profile object.
 * Combines JSON-LD business identity with the shared social/contact extractor.
 * @returns {{ name, phone, email, website, city, state, socials, url }}
 */
function parseBbbProfile(html, url = null) {
  const ld = readBusinessJsonLd(html);
  const contact = se.extractContact(html); // no host: BBB page → prefer any real email/phone/socials
  return {
    url,
    name:    ld.name || null,
    phone:   ld.phone || contact.phone || null,
    email:   ld.email || contact.email || null,
    website: ld.website || null,
    city:    ld.city || null,
    state:   ld.state || null,
    socials: contact.socials || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK LAYER (run on Mac) — polite, rate-limited, UA-rotating
// ═══════════════════════════════════════════════════════════════════════════════

let _uaIdx = 0;
const nextUA = () => UA_POOL[_uaIdx++ % UA_POOL.length];

const _lastHit = new Map(); // host -> last fetch epoch ms (per-domain rate limit)
async function politeWait(host) {
  const gap = RATE_MIN_MS + Math.floor(Math.random() * (RATE_MAX_MS - RATE_MIN_MS));
  const last = _lastHit.get(host) || 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  _lastHit.set(host, Date.now());
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
  let host; try { host = new URL(url).hostname; } catch { host = url; }
  await politeWait(host);
  const res = await fetch(url, {
    headers: { 'User-Agent': nextUA(), 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

/** Render a JS/anti-bot page via preinstalled Chromium. { html } or { unavailable/error }. */
let _renderWarned = false;
async function renderHtml(url) {
  let chromium;
  try { chromium = require('playwright').chromium; } catch {
    if (!_renderWarned) { _renderWarned = true; console.log('  (render fallback off — `npm i playwright` on the Mac to enable)'); }
    return { unavailable: true };
  }
  let browser;
  try {
    let host; try { host = new URL(url).hostname; } catch { host = url; }
    await politeWait(host);
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ userAgent: nextUA() });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
    await page.waitForTimeout(1800);
    return { html: await page.content() };
  } catch (e) {
    return { error: e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Find + confirm a BBB profile for one lead. Returns an accepted match or null. */
async function lookupBbb(lead) {
  // 1) candidates — JSON API first, then HTML search (optionally rendered for anti-bot).
  let candidates = [];
  try { candidates = parseBbbSearchJson(await fetchText(buildBbbApiUrl(lead), 'application/json,text/plain')); }
  catch { /* API unreachable/blocked — fall through to HTML */ }

  if (!candidates.length) {
    const searchUrl = buildBbbSearchUrl(lead);
    let html = null;
    try { html = await fetchText(searchUrl); } catch { /* try render */ }
    if ((!html || !parseBbbSearchHtml(html).length) && RENDER) {
      const r = await renderHtml(searchUrl);
      if (r.html) html = r.html;
    }
    if (html) candidates = parseBbbSearchHtml(html);
  }
  if (!candidates.length) return null;

  // 2) open top candidates, score against the lead, keep the best accepted match.
  let best = null;
  for (const cand of candidates.slice(0, MAX_CANDIDATES)) {
    if (!cand.url) continue;
    // Cheap pre-score from the search row alone; skip clearly-wrong rows without a fetch.
    if (cand.name && !nameMatch(lead.business_name, cand.name) && !phoneMatch(lead.phone, cand.phone)) continue;
    let phtml = null;
    try { phtml = await fetchText(cand.url); } catch { continue; }
    const profile = parseBbbProfile(phtml, cand.url);
    // profile city/phone/name may be richer than the search row — merge the row's phone in.
    if (!profile.phone && cand.phone) profile.phone = se.normalizePhone(cand.phone);
    if (!profile.city && cand.city) profile.city = cand.city;
    if (!profile.state && cand.state) profile.state = cand.state;
    if (!profile.name && cand.name) profile.name = cand.name;
    const m = scoreMatch(lead, profile);
    if (m.accepted && (!best || m.score > best.match.score)) best = { profile, match: m };
    if (best && best.match.score === 3) break; // perfect — stop early
  }
  return best;
}

const LOOKUPS = { bbb: lookupBbb };

// ═══════════════════════════════════════════════════════════════════════════════
// LEAD INDEX + ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════

const _leadsCache = new Map();
function readLeadsFile(file) {
  if (!_leadsCache.has(file)) _leadsCache.set(file, JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8')));
  return _leadsCache.get(file);
}

/** lead_id -> { file, idx } across leads/*.json. */
function buildLeadIndex() {
  const index = new Map();
  const files = fs.existsSync(LEADS_DIR) ? fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json')) : [];
  for (const file of files) {
    let arr; try { arr = readLeadsFile(file); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    arr.forEach((rec, idx) => { if (rec && rec.lead_id && !index.has(rec.lead_id)) index.set(rec.lead_id, { file, idx }); });
  }
  return index;
}

/** Only rewind leads that are mid-funnel (sent/closed are filtered out before this). */
function entryNeedsRediagnose(entry) { return !SKIP_STATUSES.has(entry.status); }

async function main() {
  console.log('\nDirectory Scraper' + `  [source: ${SOURCE}]` + (LIVE ? '  [LIVE]' : '  [DRY RUN — no writes]'));
  console.log('─'.repeat(64));

  if (SOURCE === 'yelp') {
    console.log('Yelp is phase 2 (heavy anti-bot — needs a dedicated Playwright path). Not implemented yet.');
    console.log('Run with --source bbb (default). Skipping.');
    return;
  }
  if (SOURCE === 'angi' || SOURCE === 'homeadvisor') {
    console.log(`${SOURCE} puts contact data behind a login wall — skipped by design. Use --source bbb.`);
    return;
  }
  const lookup = LOOKUPS[SOURCE];
  if (!lookup) { console.log(`Unknown --source "${SOURCE}". Supported: bbb (default).`); return; }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const leadIndex = buildLeadIndex();

  // Eligible: in queue, not sent/closed, has business_name + city to search on, and is
  // still missing enrichable data (no email OR no socials). We can locate the record.
  const candidates = [];
  let skippedStatus = 0, noRecord = 0, notSearchable = 0, alreadyRich = 0;
  for (const entry of state.queue) {
    if (SKIP_STATUSES.has(entry.status)) { skippedStatus++; continue; }
    const loc = leadIndex.get(entry.lead_id);
    if (!loc) { noRecord++; continue; }
    const rec = readLeadsFile(loc.file)[loc.idx];
    if (!hasVal(rec.business_name) || !hasVal(rec.city)) { notSearchable++; continue; }
    const hasSocials = rec.socials && typeof rec.socials === 'object' && Object.keys(rec.socials).length;
    if (hasVal(rec.email) && hasSocials) { alreadyRich++; continue; }
    candidates.push({ entry, loc, rec });
  }
  // Enrich leads missing an email first (higher value — an email flip re-diagnoses the lead).
  candidates.sort((a, b) => (hasVal(a.rec.email) ? 1 : 0) - (hasVal(b.rec.email) ? 1 : 0));

  console.log(`Queue: ${state.queue.length} leads`);
  console.log(`  skipped (sent/closed):     ${skippedStatus}`);
  console.log(`  no lead record found:      ${noRecord}`);
  console.log(`  not searchable (name/city):${notSearchable}`);
  console.log(`  already have email+socials:${alreadyRich}`);
  console.log(`  → eligible to enrich:      ${candidates.length}` + (LIMIT !== Infinity ? ` (capped at ${LIMIT})` : ''));
  console.log('─'.repeat(64));

  const todo = candidates.slice(0, LIMIT);
  let processed = 0, matched = 0, flipped = 0, errors = 0;
  let phonesFound = 0, namesFound = 0, sitesFound = 0, socialsFound = 0;
  const dirtyFiles = new Set();
  const flippedLeads = [];

  for (const c of todo) {
    processed++;
    const label = c.rec.business_name;
    let result;
    try {
      result = await lookup(c.rec);
    } catch (e) {
      errors++;
      console.log(`[${processed}/${todo.length}] ${label} … error (${e.message})`);
      continue;
    }
    if (!result) {
      console.log(`[${processed}/${todo.length}] ${label} … no confident match`);
      continue;
    }
    matched++;
    const { profile, match } = result;
    const pct = Math.round(match.confidence * 100);

    // ADDITIVE plan: only fields that are currently empty on the lead.
    const cur = c.rec;
    const newEmail = (profile.email && !hasVal(cur.email)) ? profile.email : null;
    const newPhone = (profile.phone && !hasVal(cur.phone)) ? profile.phone : null;
    const newSite  = (profile.website && !hasVal(cur.website)) ? profile.website : null;
    const curSocials = (cur.socials && typeof cur.socials === 'object') ? cur.socials : {};
    const addSocials = {};
    if (profile.socials) for (const [k, v] of Object.entries(profile.socials)) if (!hasVal(curSocials[k])) addSocials[k] = v;
    const hasNewSocials = Object.keys(addSocials).length > 0;

    if (newEmail) { flipped++; flippedLeads.push({ business: label, email: newEmail }); }
    if (newPhone) phonesFound++;
    if (newSite)  sitesFound++;
    if (hasNewSocials) socialsFound++;

    const parts = [];
    if (profile.email) parts.push(`✉ ${profile.email}${newEmail ? '' : ' (had)'}`);
    if (profile.phone) parts.push(`☎ ${profile.phone}${newPhone ? '' : ' (had)'}`);
    if (profile.website) parts.push(`web`);
    if (profile.socials) parts.push(`${Object.keys(profile.socials).length} social`);
    console.log(`[${processed}/${todo.length}] ${label} … ✓ match ${pct}% [${signalStr(match.matched)}]  ${parts.join('  ') || '(no new fields)'}`);

    const anyNew = newEmail || newPhone || newSite || hasNewSocials;
    if (!LIVE) continue;

    if (anyNew) {
      const rec = readLeadsFile(c.loc.file)[c.loc.idx];
      if (newEmail) { rec.email = newEmail; rec.email_source = 'directory-scraper'; }
      if (newPhone) rec.phone = newPhone;
      if (newSite)  rec.website = newSite;
      if (profile.name && !hasVal(rec.contact_name)) { /* BBB name is the business, not a person — do not fill contact_name */ }
      if (hasNewSocials) rec.socials = { ...curSocials, ...addSocials };
      rec.directory_enriched_at = new Date().toISOString();
      dirtyFiles.add(c.loc.file);
    }
    // state.json — additive directory metadata (always on a match), re-queue only on a new email.
    c.entry.directorySource = SOURCE;
    c.entry.directoryProfiles = (c.entry.directoryProfiles || []).concat([{ source: SOURCE, url: profile.url, confidence: match.confidence }]);
    c.entry.directoryEnrichedAt = new Date().toISOString();
    if (newEmail && entryNeedsRediagnose(c.entry)) {
      c.entry.preScrapeStatus = c.entry.status;
      c.entry.status = 'scouted';
      c.entry.scrapedEmailAt = new Date().toISOString();
    }
  }

  if (LIVE) {
    for (const file of dirtyFiles) {
      fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(readLeadsFile(file), null, 2));
    }
    if (matched > 0) fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(64));
  console.log('Summary');
  console.log(`  leads processed:      ${processed}`);
  console.log(`  confident matches:    ${matched}`);
  console.log(`  new emails (flips):   ${flipped}`);
  console.log(`  new phones:           ${phonesFound}`);
  console.log(`  new websites:         ${sitesFound}`);
  console.log(`  new socials:          ${socialsFound}`);
  console.log(`  no match / errors:    ${processed - matched} / ${errors}`);
  if (flippedLeads.length) {
    console.log('\nFlipped to email (will re-diagnose):');
    for (const f of flippedLeads) console.log(`  • ${f.business} → ${f.email}`);
  }
  if (!LIVE) {
    console.log('\n[dry-run] nothing written. Re-run with --live (or DIRECTORY_LIVE=1) to apply.');
  } else {
    if (flipped > 0) console.log('\nNext: node scripts/diagnoser.js → checker.js → pitcher.js --channel email');
    console.log('Then: node scripts/sheet-log.js   # push new socials to the CRM (AllContacts)');
  }
  if (errors === processed && processed > 0) {
    console.log('\n⚠  Every lookup errored. In the container this is expected (proxy blocks BBB).');
    console.log('   Run this on the Mac for real results.');
  }
}

function signalStr(m) {
  return ['name', 'city', 'phone'].filter(k => m[k]).join('+') || 'none';
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

// Exported for unit testing (pure functions only — no network/I/O).
module.exports = {
  nameTokens, nameMatch, cityState, cityMatch, phoneMatch, scoreMatch,
  buildBbbApiUrl, buildBbbSearchUrl, parseBbbSearchJson, parseBbbSearchHtml,
  readBusinessJsonLd, parseBbbProfile, signalStr,
};
