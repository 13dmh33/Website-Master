/**
 * directory-scout — shared foundation for public-directory lead scrapers
 * (Yellow Pages, BBB, state licensing boards). All the pipeline plumbing lives
 * here; per-source adapters only provide URL-building + HTML/JSON parsing.
 *
 * WHY this exists:
 *   Google Maps (Outscraper, via Scout) only returns a website URL for ~35% of
 *   listings — the other ~65% leave the field blank, so the contact-scraper has
 *   nothing to visit. Public directories list the contractor's own website far
 *   more reliably. This module turns any such directory into Scout-shaped leads
 *   so the existing pipeline (contact-scraper → Diagnoser → Checker → Pitcher)
 *   works unchanged.
 *
 * Output contract (identical to scout-has-website.js):
 *   Each lead is written to leads/*.json and queued in state.json as 'scouted'.
 *   Leads WITH an email feed the email pipeline directly. Leads with a site_url
 *   but no email are picked up later by scripts/contact-scraper.js (which visits
 *   the site and fills the email). Leads with neither route to needs-email.
 *
 * Adapter interface (see dir-yellowpages.js for the reference implementation):
 *   {
 *     SOURCE: 'yellowpages',
 *     buildSearchUrls(trade, city, opts) -> [url, ...],   // one per page
 *     parseListings(bodyText, ctx)       -> [rawListing],  // pure, no I/O
 *   }
 * A rawListing is: { business_name, site_url?, email?, phone?, rating?,
 *   review_count?, address? }. Everything except business_name is optional.
 *
 * This file separates PURE functions (formatLead, dedupAndFormat, toCsv,
 * hostFromUrl) from I/O (fetchBody, writeLeadsAndQueue, loadKnown*) so the pure
 * half is unit-testable without network or disk. Only the pure half is exported
 * for tests; the runner (scripts/directory-scout.js) drives the I/O half.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { slugify, normalizeDomain } = require('./scout-shared');

const ROOT       = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');
const LEADS_WEB_DIR = path.join(ROOT, 'leads-web');

// Reuse the has-website filter's platform/social rejection so a directory that
// links to a Facebook/Yelp page instead of a real site doesn't slip through.
const { isRealWebsite } = require('./scout-has-website');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;

// ── PURE: lead formatting ─────────────────────────────────────────────────────

/** Registrable host of a URL, or null. Thin wrapper over normalizeDomain. */
function hostFromUrl(url) {
  return normalizeDomain(url);
}

/**
 * Turn one adapter rawListing into a pipeline lead record (scout-has-website
 * shape). Pure — no I/O, no dedup. `source` is recorded for provenance so the
 * Sheet/Reporter can see which directory a lead came from.
 */
function formatLead(raw, { trade, city, source }) {
  const name = (raw.business_name || '').trim();
  const site = raw.site_url && isRealWebsite(raw.site_url) ? raw.site_url.trim() : '';
  return {
    lead_id:       `${slugify(name)}-${slugify(city)}`,
    business_name: name,
    trade,
    city,
    site_url:      site,
    email:         raw.email ? String(raw.email).trim().toLowerCase() : '',
    phone:         raw.phone ? String(raw.phone).trim() : '',
    rating:        Number(raw.rating) || 0,
    review_count:  Number(raw.review_count) || 0,
    address:       (raw.address || '').trim(),
    place_id:      null,                 // directories have no GMB place_id
    subtypes:      [],
    latitude:      null,
    longitude:     null,
    fit_score:     0,                    // no review-band scoring from directories
    gap_score:     0,                    // alias — keeps Diagnoser's sort working
    source:        `directory:${source}`,
    scraped_at:    new Date().toISOString(),
  };
}

/**
 * Format + dedup a batch of rawListings. Drops:
 *   - blank names,
 *   - anything whose lead_id is already known (state.json + leads/*),
 *   - anything whose site domain is already known (catches the same business
 *     listed under two directory entries / relists),
 *   - in-run duplicates (same lead_id or same domain seen earlier this run).
 * Returns { leads, needsEmail, disc }. `leads` have a site_url or email (usable
 * by the pipeline); `needsEmail` have neither (name/phone/address only — these
 * route to a needs-email CSV for Apollo/manual lookup, never discarded).
 */
function dedupAndFormat(rawListings, { trade, city, source, knownIds = new Set(), knownDomains = new Set() }) {
  const disc = { noName: 0, duplicate: 0, platformOnly: 0 };
  const leads = [];
  const needsEmail = [];
  const seenIds = new Set();
  const seenDomains = new Set();

  for (const raw of rawListings) {
    const name = (raw.business_name || '').trim();
    if (!name) { disc.noName++; continue; }

    const lead = formatLead(raw, { trade, city, source });

    if (knownIds.has(lead.lead_id) || seenIds.has(lead.lead_id)) { disc.duplicate++; continue; }

    // A raw site that's platform-only (facebook/yelp) is stripped by formatLead
    // (site_url becomes ''), so count it for visibility but still keep the lead
    // if it has an email or phone to work with.
    if (raw.site_url && !lead.site_url) disc.platformOnly++;

    const domain = lead.site_url ? normalizeDomain(lead.site_url) : null;
    if (domain && (knownDomains.has(domain) || seenDomains.has(domain))) { disc.duplicate++; continue; }

    seenIds.add(lead.lead_id);
    if (domain) seenDomains.add(domain);

    if (lead.site_url || lead.email) leads.push(lead);
    else needsEmail.push(lead);
  }

  return { leads, needsEmail, disc };
}

/** CSV for the usable leads (mirrors exportAuditorCsv's spirit; includes phone). */
function toCsv(leads) {
  const header = 'business_name,trade,city,site_url,email,phone,source';
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = leads.map(l => [
    esc(l.business_name), l.trade, l.city, l.site_url, l.email, l.phone, l.source,
  ].join(','));
  return [header, ...rows].join('\n');
}

// ── I/O: fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch a URL as text. Throws on non-2xx or timeout. Container egress is
 * proxy-gated to package registries + Anthropic, so arbitrary directory sites
 * 403/fail here — these scrapers are Mac-only (same constraint as Scout).
 */
async function fetchBody(url, { accept = 'text/html,application/xhtml+xml' } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': accept, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.text();
}

// ── I/O: dedup sources ────────────────────────────────────────────────────────

function collectFromLeadsDir(dir, pick) {
  const out = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (Array.isArray(arr)) for (const l of arr) pick(l, out);
    } catch { /* skip malformed */ }
  }
  return out;
}

/** All known lead_ids across state.json queue/active/closed + leads/ + leads-web/. */
function loadKnownIds() {
  const ids = new Set();
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    for (const bucket of ['queue', 'active', 'closed']) {
      for (const l of state[bucket] || []) ids.add(l.lead_id || l);
    }
  } catch { /* no state yet */ }
  for (const dir of [LEADS_DIR, LEADS_WEB_DIR]) {
    for (const id of collectFromLeadsDir(dir, (l, s) => {
      if (l.lead_id) s.add(l.lead_id);
      if (l.place_id) s.add(l.place_id);
    })) ids.add(id);
  }
  return ids;
}

/** All known site domains across leads/ + leads-web/ (catches cross-source relists). */
function loadKnownDomains() {
  const domains = new Set();
  for (const dir of [LEADS_DIR, LEADS_WEB_DIR]) {
    for (const d of collectFromLeadsDir(dir, (l, s) => {
      const dom = normalizeDomain(l.site_url || l.website);
      if (dom) s.add(dom);
    })) domains.add(d);
  }
  return domains;
}

// ── I/O: write leads + queue ──────────────────────────────────────────────────

function uniqueFilename(dir, base, ext) {
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base}-run${i}.${ext}`))) i++;
  return `${base}-run${i}.${ext}`;
}

/**
 * Persist usable leads to leads/*.json and queue them in state.json as
 * 'scouted' (additive — never touches existing entries). Mirrors Scout's
 * updateState exactly. Returns { file, queued }.
 */
function writeLeadsAndQueue(leads, { source, city, trade }) {
  if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
  const dateStr = new Date().toISOString().split('T')[0];
  const base    = `dir-${slugify(source)}-${slugify(city)}-${slugify(trade)}-${dateStr}`;
  const file    = uniqueFilename(LEADS_DIR, base, 'json');
  fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(leads, null, 2));

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const existing = new Set([
    ...state.queue.map(l => l.lead_id || l),
    ...state.active.map(l => l.lead_id || l),
    ...state.closed.map(l => l.lead_id || l),
  ]);
  const now = new Date().toISOString();
  let queued = 0;
  for (const l of leads) {
    if (existing.has(l.lead_id)) continue;
    state.queue.push({ lead_id: l.lead_id, status: 'scouted', added_at: now });
    queued++;
  }
  state.daily_stats = state.daily_stats || {};
  state.daily_stats.leads_scouted = (state.daily_stats.leads_scouted || 0) + queued;
  state.last_run = now;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  return { file, queued };
}

/** Write a needs-email CSV (name/phone/address only) to leads-web/ for Apollo/manual. */
function writeNeedsEmailCsv(needsEmail, { source, city, trade }) {
  if (!needsEmail.length) return null;
  if (!fs.existsSync(LEADS_WEB_DIR)) fs.mkdirSync(LEADS_WEB_DIR, { recursive: true });
  const dateStr = new Date().toISOString().split('T')[0];
  const base    = `needs-email-dir-${slugify(source)}-${slugify(city)}-${slugify(trade)}-${dateStr}`;
  const file    = uniqueFilename(LEADS_WEB_DIR, base, 'csv');
  const header  = 'business_name,trade,city,phone,address,source';
  const esc     = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows    = needsEmail.map(l => [esc(l.business_name), l.trade, l.city, l.phone, esc(l.address), l.source].join(','));
  fs.writeFileSync(path.join(LEADS_WEB_DIR, file), [header, ...rows].join('\n'));
  return file;
}

module.exports = {
  // pure (tested)
  formatLead, dedupAndFormat, toCsv, hostFromUrl,
  // i/o
  fetchBody, loadKnownIds, loadKnownDomains, writeLeadsAndQueue, writeNeedsEmailCsv,
  // constants
  UA, LEADS_DIR, LEADS_WEB_DIR,
};
