#!/usr/bin/env node
/**
 * Owner Resolver — name the human owner of a lead from FREE public records.
 *
 * The no-website, no-Apollo path to an owner's name. Scout's no-website corpus has
 * ~0 owner names and ~0 domains (measured: 0/322 names, 2/322 sites) — so the owner
 * cannot come from the business's website or from email permutation. It has to come
 * from OFF-SITE public records that key off what we already have (business name +
 * city): state business registries and contractor license boards.
 *
 * A named owner is the unlock for personalized outreach on the channels you already
 * use — "Hey John" on SMS / cold call / DM / direct mail — even with no email.
 *
 * ARCHITECTURE
 *   Framework + pluggable per-source ADAPTERS. Each adapter takes a lead and returns
 *   { owner_name, source, confidence, profile, match } or null. Adapters are chosen
 *   per lead by geography (a CO adapter only runs on CO leads, etc.).
 *   Implemented: co-sos (Colorado SOS business registry — a FREE Socrata JSON API).
 *   Planned:     co-dora (license board), az-roc, fl-sunbiz, tx-*.
 *
 * MATCHING (reuses directory-scraper's ≥2-of-3 gate)
 *   Registries have many same/similar-named LLCs, so wrong-owner is the main risk.
 *   The CO dataset has NO phone/email, so only name + city signals exist → we require
 *   BOTH (a strict 2-of-2), plus: skip commercial registered-agent services (they are
 *   not the owner), and skip when accepted rows disagree on the owner (ambiguous →
 *   never guess). Confidence is logged.
 *
 * WRITES (additive only; no re-diagnosis)
 *   Fills the lead record's empty `contact_name` (the owner) + `owner_source`,
 *   `owner_confidence`, `owner_mailing_*`, `owner_resolved_at`. Finding a NAME does
 *   NOT change the outreach channel, so — unlike an email flip — it never rewinds a
 *   lead's status. state.json gets `ownerSource`/`ownerResolvedAt` metadata only.
 *
 * GUARDRAILS
 *   Dry-run is the DEFAULT (pass --live or OWNER_LIVE=1 to write). Polite: ~1 req/sec
 *   per host, 10s timeout. Optional Socrata app token (SOCRATA_APP_TOKEN) raises rate
 *   limits but is not required.
 *
 * Usage:
 *   node scripts/owner-resolver.js                 # DRY RUN — show resolved owners
 *   node scripts/owner-resolver.js --live          # write contact_name to lead records
 *   node scripts/owner-resolver.js --limit 20
 *   node scripts/owner-resolver.js --source co-sos # (default; only source today)
 *
 * NOTE: data.colorado.gov is blocked by the container proxy (Host not in allowlist) —
 *   run on the Mac, or allowlist the host. The field names are verified against the
 *   Socrata API Foundry docs; parsing is tolerant if the schema drifts.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const dm   = require('./directory-scraper');     // reuse nameTokens/nameMatch/cityState/cityMatch/scoreMatch
const se   = require('./lib/social-extractor');  // normalizePhone for AZ ROC text parsing

const ROOT       = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');

function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const LIVE   = process.argv.includes('--live') || process.env.OWNER_LIVE === '1';
const LIMIT  = parseInt(getArg('--limit'), 10) || Infinity;
const SOURCE = (getArg('--source') || 'co-sos').toLowerCase();

const SKIP_STATUSES = new Set(['sent', 'closed']);
const hasVal = v => v && String(v).trim();
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════════
// PURE LOGIC (no I/O) — exported for tests
// ═══════════════════════════════════════════════════════════════════════════════

/** Commercial registered-agent services — their name is NOT the business owner. */
const RA_SERVICES = [
  'registered agent', 'registered agents', 'legalzoom', 'northwest', 'cogency',
  'corporation service', 'csc', 'incfile', 'harbor compliance', 'national registered',
  'ct corporation', 'vcorp', 'zenbusiness', 'bizfilings', 'united states corporation',
  'inc authority', 'swyft', 'capitol services', 'paracorp', 'registered agent solutions',
];
function isRegisteredAgentService(name) {
  const n = String(name || '').toLowerCase();
  return RA_SERVICES.some(s => n.includes(s));
}

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();
}

/** Person owner name from a CO row's registered-agent fields, or null if it's an org/RA service/blank. */
function agentOwnerName(row) {
  if (hasVal(row.agentorganizationname)) return null; // agent is an organization, not a person
  const first = String(row.agentfirstname || '').trim();
  const last  = String(row.agentlastname  || '').trim();
  if (!first || !last) return null;
  const mid = String(row.agentmiddlename || '').trim();
  const name = [first, mid, last].filter(Boolean).join(' ');
  if (isRegisteredAgentService(name)) return null;
  return titleCase(name);
}

/** CO entity statuses we treat as "live" (owner data is current). Others rank lower, not excluded. */
const GOOD_STATUS = /good standing|exists|active/i;

/** One CO SODA row → normalized profile the matcher understands. */
function rowToProfile(row) {
  return {
    name:      row.entityname || null,
    city:      row.principalcity || null,
    state:     row.principalstate || null,
    phone:     null,                       // dataset has no phone
    ownerName: agentOwnerName(row),
    status:    row.entitystatus || '',
    type:      row.entitytype || '',
    mailing:   [row.mailingaddress1, row.mailingcity, row.mailingstate, row.mailingzipcode].filter(Boolean).join(', ') || null,
  };
}

/** Numeric name-token overlap (0–1) — used to break ties / detect ambiguity. */
function nameOverlap(a, b) {
  const ta = dm.nameTokens(a), tb = dm.nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Choose the owner from CO rows for a lead.
 * @returns {{ owner_name, source:'co-sos', confidence, profile, match }|null}
 * null when: no accepted row with a person owner, or accepted rows disagree on the owner (ambiguous).
 */
function resolveFromCoRows(rows, lead) {
  const scored = [];
  for (const raw of rows || []) {
    const profile = rowToProfile(raw);
    if (!profile.ownerName) continue;                 // no person owner on this filing
    const match = dm.scoreMatch(lead, profile, 2);    // phone absent → needs name AND city
    if (!match.accepted) continue;
    scored.push({
      profile, match,
      overlap: nameOverlap(lead.business_name, profile.name),
      active:  GOOD_STATUS.test(profile.status) ? 1 : 0,
    });
  }
  if (!scored.length) return null;

  // Best = strongest name overlap, then active status.
  scored.sort((a, b) => (b.overlap - a.overlap) || (b.active - a.active));
  const best = scored[0];

  // Ambiguity guard: if another equally-good row names a DIFFERENT owner, don't guess.
  const rivals = scored.filter(s =>
    s.profile.ownerName.toLowerCase() !== best.profile.ownerName.toLowerCase() &&
    s.overlap >= best.overlap - 1e-9);
  if (rivals.length) return null;

  const consensus = scored.every(s => s.profile.ownerName.toLowerCase() === best.profile.ownerName.toLowerCase());
  let confidence = best.match.confidence;             // 2/3 = ~0.67 (name+city; no phone in dataset)
  if (best.active) confidence += 0.1;
  if (consensus)   confidence += 0.1;
  confidence = Math.min(0.9, Math.round(confidence * 100) / 100);

  return { owner_name: best.profile.ownerName, source: 'co-sos', confidence, profile: best.profile, match: best.match };
}

// ── co-dora: Colorado DORA professional/occupational licenses (Socrata 7s5z-vewr) ──
// Confirms a lead is a licensed CO plumbing/electrical contractor and, when the
// contractor record carries a responsible person, names the owner. The dataset has
// separate firstName/lastName (the licensee) and entityName (the firm), so a lead's
// business is matched on entityName + city; the person fields give the owner name.

/** 'plumber' | 'electrician' | null from a lead's or a DORA row's trade text. */
function tradeKey(t) {
  const s = String(t || '').toLowerCase();
  if (/plumb/.test(s)) return 'plumber';
  if (/electric|wireman/.test(s)) return 'electrician';
  return null;
}

/** Licensed trade of a DORA row from its prefix/sub-category/specialty/title. */
function doraTradeOf(row) {
  const hay = [row.licensePrefix, row.subCategory, row.specialty, row.title].map(x => String(x || '')).join(' ');
  return tradeKey(hay);
}

/** Person (licensee) name from a DORA row's firstName/middleName/lastName, or null. */
function doraPersonName(row) {
  const first = String(row.firstName || '').trim();
  const last  = String(row.lastName  || '').trim();
  if (!first || !last) return null;
  const mid = String(row.middleName || '').trim();
  return titleCase([first, mid, last].filter(Boolean).join(' '));
}

/** One DORA row → normalized profile (name = entityName so the firm can be matched). */
function rowToDoraProfile(row) {
  return {
    name:          row.entityName || null,
    city:          row.city || null,
    state:         row.state || null,
    phone:         null,                       // dataset has no phone
    ownerName:     doraPersonName(row),
    licenseNumber: row.licenseNumber || null,
    licenseStatus: row.licenseStatusDescription || null,
    licensedTrade: doraTradeOf(row),
    verifyUrl:     row.linkToVerifyLicense || null,
    prefix:        row.licensePrefix || null,
  };
}

/**
 * Choose the licensed contractor record for a lead.
 * @returns {{ source:'co-dora', confidence, owner_name:string|null, extra:object|null, profile, match }|null}
 * owner_name is filled only when the matched record names a person (and rows agree);
 * `extra` always carries the licensure fields on a confident firm match.
 */
function resolveFromDoraRows(rows, lead) {
  const leadTrade = tradeKey(lead.trade);
  const scored = [];
  for (const raw of rows || []) {
    const profile = rowToDoraProfile(raw);
    if (!profile.name) continue;                                             // individual-only record — no firm to match
    if (leadTrade && profile.licensedTrade && profile.licensedTrade !== leadTrade) continue; // wrong trade
    const match = dm.scoreMatch(lead, profile, 2);                           // entityName + city (no phone)
    if (!match.accepted) continue;
    scored.push({
      profile, match,
      overlap:    nameOverlap(lead.business_name, profile.name),
      active:     GOOD_STATUS.test(profile.licenseStatus || '') ? 1 : 0,
      contractor: /^(PC|EC)$/i.test(profile.prefix || '') ? 1 : 0,           // firm-level (vs individual) license
    });
  }
  if (!scored.length) return null;

  scored.sort((a, b) => (b.overlap - a.overlap) || (b.contractor - a.contractor) || (b.active - a.active));
  const best = scored[0];

  // Owner name only when equally-good rows don't name a different person (else licensure only).
  let ownerName = best.profile.ownerName;
  if (ownerName) {
    const rivals = scored.filter(s => s.overlap >= best.overlap - 1e-9 &&
      s.profile.ownerName && s.profile.ownerName.toLowerCase() !== ownerName.toLowerCase());
    if (rivals.length) ownerName = null;
  }

  let confidence = best.match.confidence + (best.active ? 0.1 : 0);
  confidence = Math.min(0.9, Math.round(confidence * 100) / 100);

  const extra = {};
  if (best.profile.licenseNumber) extra.license_number     = best.profile.licenseNumber;
  if (best.profile.licenseStatus) extra.license_status     = best.profile.licenseStatus;
  if (best.profile.licensedTrade) extra.licensed_trade     = best.profile.licensedTrade;
  if (best.profile.verifyUrl)     extra.license_verify_url = best.profile.verifyUrl;

  return {
    source: 'co-dora', confidence,
    owner_name: ownerName || null,
    extra: Object.keys(extra).length ? extra : null,
    profile: best.profile, match: best.match,
  };
}

// ── az-roc: Arizona Registrar of Contractors (Salesforce portal, NO open API) ──
// Arizona publishes ROC data ONLY through a Salesforce Experience Cloud site
// (azroc.my.site.com) — there is no Socrata/JSON feed. So retrieval must render
// the portal (Playwright) and parse text. The PURE logic below (matching, owner
// selection, trade gate, licensure) is fully tested; the retrieval + text parser
// are a best-effort whose exact field layout must be CONFIRMED ON A LIVE MAC RUN
// (capture one real profile's text to harden the regexes). Unlike the CO datasets,
// AZ ROC profiles usually include a PHONE, enabling a stronger 3-signal match.

/** person-name shape: 2–3 capitalized tokens (allows a middle initial, apostrophes, hyphens).
 *  Inter-token spacing is [ \t] ONLY — a name must never run across a line break into the
 *  next labelled field (e.g. "Owner Maria Gonzalez\nQualifying Party ..." → "Maria Gonzalez"). */
const AZ_PERSON = "[A-Z][A-Za-z'.-]+(?:[ \\t]+[A-Z][A-Za-z'.-]?\\.?)?(?:[ \\t]+[A-Z][A-Za-z'.-]+){1,2}";

/** Extract the first person name following any of the given role labels in rendered text. */
function personAfterLabel(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}[^\\S\\n]*[:#-]?[^\\S\\n]*(${AZ_PERSON})`, 'i');
    const m = String(text || '').match(re);
    if (m && m[1]) return titleCase(m[1].replace(/[ \t]+/g, ' ').trim());
  }
  return null;
}

/**
 * Parse one rendered AZ ROC contractor profile (text) → normalized record.
 * LAYOUT ASSUMED — confirm against a real captured profile on the Mac.
 * @returns {{ name, dba, city, state, phone, ownerName, licenseNumber, licenseStatus, licenseClass, licensedTrade }}
 */
function parseAzRocProfileText(text) {
  const t = String(text || '').replace(/\r/g, ' ');
  const grab = re => { const m = t.match(re); return m ? m[1].trim() : null; };
  const licenseNumber = (() => { const m = t.match(/\bROC\s*#?\s*(\d{3,7})/i); return m ? `ROC ${m[1]}` : null; })();
  const name  = grab(/Business Name\s*[:#-]?\s*([^\n|]+?)(?:\s{2,}|\n|$)/i);
  const dba   = grab(/\bDBA\s*[:#-]?\s*([^\n|]+?)(?:\s{2,}|\n|$)/i);
  const status = grab(/\bStatus\s*[:#-]?\s*([A-Za-z ]+?)(?:\s{2,}|\n|$)/i);
  const licenseClass = grab(/Class(?:ification)?\s*[:#-]?\s*([A-Za-z]{1,3}-?\d{1,3}[^\n|]*?)(?:\s{2,}|\n|$)/i);
  const city  = grab(/\bCity\s*[:#-]?\s*([A-Za-z .'-]+?)(?:\s{2,}|\n|$)/i);
  const state = grab(/\bState\s*[:#-]?\s*([A-Z]{2})\b/i);
  const phoneRaw = grab(/(?:Phone|Tel)\s*[:#-]?\s*([\d().\-\s]{7,})/i);
  // Owner/member preferred over the qualifying party (the qualifier may be an employee).
  const ownerName =
    personAfterLabel(t, ['Owner', 'Member', 'Officer', 'President', 'Managing Member', 'Principal']) ||
    personAfterLabel(t, ['Qualifying Party', 'Qualifier']);
  return {
    name: name || null,
    dba: dba || null,
    city: city || null,
    state: state || null,
    phone: phoneRaw ? se.normalizePhone(phoneRaw) : null,
    ownerName: ownerName || null,
    licenseNumber,
    licenseStatus: status || null,
    licenseClass: licenseClass || null,
    licensedTrade: tradeKey(`${licenseClass || ''} ${name || ''}`),
  };
}

/** Normalized AZ record → matcher profile (name = business so the firm can be matched). */
function rowToAzProfile(rec) {
  return {
    name:          rec.name || null,
    city:          rec.city || null,
    state:         rec.state || null,
    phone:         rec.phone || null,          // AZ ROC usually HAS a phone → 3-signal match
    ownerName:     rec.ownerName || null,
    licenseNumber: rec.licenseNumber || null,
    licenseStatus: rec.licenseStatus || null,
    licensedTrade: rec.licensedTrade || null,
    licenseClass:  rec.licenseClass || null,
  };
}

/**
 * Choose the AZ ROC record for a lead (name+city+phone; ≥2 of 3).
 * @returns {{ source:'az-roc', confidence, owner_name, extra, profile, match }|null}
 */
function resolveFromAzRecords(records, lead) {
  const leadTrade = tradeKey(lead.trade);
  const scored = [];
  for (const raw of records || []) {
    const profile = rowToAzProfile(raw);
    if (!profile.name) continue;
    if (leadTrade && profile.licensedTrade && profile.licensedTrade !== leadTrade) continue; // wrong trade
    const match = dm.scoreMatch(lead, profile, 2);
    if (!match.accepted) continue;
    scored.push({
      profile, match,
      overlap: nameOverlap(lead.business_name, profile.name),
      active:  /active/i.test(profile.licenseStatus || '') ? 1 : 0,
    });
  }
  if (!scored.length) return null;

  scored.sort((a, b) => (b.match.score - a.match.score) || (b.overlap - a.overlap) || (b.active - a.active));
  const best = scored[0];

  let ownerName = best.profile.ownerName;
  if (ownerName) {
    const rivals = scored.filter(s => s.overlap >= best.overlap - 1e-9 &&
      s.profile.ownerName && s.profile.ownerName.toLowerCase() !== ownerName.toLowerCase());
    if (rivals.length) ownerName = null;
  }

  let confidence = best.match.confidence + (best.active ? 0.05 : 0);
  confidence = Math.min(0.95, Math.round(confidence * 100) / 100);

  const extra = {};
  if (best.profile.licenseNumber) extra.license_number = best.profile.licenseNumber;
  if (best.profile.licenseStatus) extra.license_status = best.profile.licenseStatus;
  if (best.profile.licensedTrade) extra.licensed_trade = best.profile.licensedTrade;
  if (best.profile.licenseClass)  extra.license_class  = best.profile.licenseClass;

  return {
    source: 'az-roc', confidence,
    owner_name: ownerName || null,
    extra: Object.keys(extra).length ? extra : null,
    profile: best.profile, match: best.match,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════════

const CO_SOS_RESOURCE  = 'https://data.colorado.gov/resource/4ykn-tg5h.json';
const CO_DORA_RESOURCE = 'https://data.colorado.gov/resource/7s5z-vewr.json';

/** SODA query URL: full-text search on the business name, capped. */
function buildCoSosUrl(lead, limit = 25) {
  return `${CO_SOS_RESOURCE}?$q=${encodeURIComponent(lead.business_name || '')}&$limit=${limit}`;
}
function buildCoDoraUrl(lead, limit = 25) {
  return `${CO_DORA_RESOURCE}?$q=${encodeURIComponent(lead.business_name || '')}&$limit=${limit}`;
}

const _lastHit = new Map();
async function politeWait(host) {
  const last = _lastHit.get(host) || 0;
  const wait = last + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  _lastHit.set(host, Date.now());
}

/** Fetch a Socrata SODA JSON endpoint politely (shared by all CIM adapters). */
async function fetchSocrataRows(url) {
  await politeWait('data.colorado.gov');
  const headers = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

const isCO = rec => dm.cityState(rec.city).state === 'co';
const isAZ = rec => dm.cityState(rec.city).state === 'az';

/** CO Secretary of State — registered-agent owner for any CO LLC/Corp lead w/o a name. */
const coSosAdapter = {
  id: 'co-sos',
  eligible: rec => isCO(rec) && !hasVal(rec.contact_name),
  async lookup(lead) { return resolveFromCoRows(await fetchSocrataRows(buildCoSosUrl(lead)), lead); },
};

/** CO DORA licenses — licensure (+ owner for contractor records) for CO plumbing/electrical leads. */
const coDoraAdapter = {
  id: 'co-dora',
  eligible: rec => isCO(rec) && !!tradeKey(rec.trade) && (!hasVal(rec.contact_name) || !hasVal(rec.license_number)),
  async lookup(lead) { return resolveFromDoraRows(await fetchSocrataRows(buildCoDoraUrl(lead)), lead); },
};

const AZ_ROC_SEARCH = 'https://azroc.my.site.com/AZRoc/s/contractor-search';

/**
 * Render the AZ ROC Salesforce portal and pull candidate contractor records for a lead.
 * BEST-EFFORT / UNVERIFIED: the portal is a Salesforce Experience site with no API, so
 * this navigates the search UI and parses rendered text. The search-trigger + result
 * selectors are a first guess — CONFIRM on a live Mac run (capture a real profile's text
 * and harden parseAzRocProfileText). Returns [] on any failure (adapter → "no match",
 * never crashes). Requires `playwright`; skipped gracefully if not installed.
 */
let _azWarned = false;
async function fetchAzRocRecords(lead) {
  let chromium;
  try { chromium = require('playwright').chromium; } catch {
    if (!_azWarned) { _azWarned = true; console.log('  (az-roc needs Playwright — `npm i playwright` on the Mac)'); }
    return [];
  }
  let browser;
  try {
    await politeWait('azroc.my.site.com');
    browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();
    await page.goto(AZ_ROC_SEARCH, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Type the business name into the first visible search box and submit. [VERIFY ON MAC]
    const box = page.locator('input[type="text"], input[type="search"]').first();
    await box.fill(lead.business_name || '', { timeout: 8000 });
    await box.press('Enter');
    await page.waitForTimeout(3500); // let Lightning render results
    // Follow each result to its profile and parse the rendered text. [VERIFY ON MAC]
    const links = await page.locator('a[href*="licenseId="]').evaluateAll(
      els => els.map(e => e.getAttribute('href')).filter(Boolean).slice(0, 5));
    const records = [];
    for (const href of links) {
      const url = href.startsWith('http') ? href : new URL(href, AZ_ROC_SEARCH).href;
      try {
        await politeWait('azroc.my.site.com');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2500);
        const text = await page.evaluate(() => document.body ? document.body.innerText : '');
        const rec = parseAzRocProfileText(text);
        if (rec.name) records.push(rec);
      } catch { /* one bad profile never aborts the lead */ }
    }
    return records;
  } catch {
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** AZ Registrar of Contractors — owner/qualifying party + licensure for AZ leads. Playwright-only. */
const azRocAdapter = {
  id: 'az-roc',
  eligible: rec => isAZ(rec) && (!hasVal(rec.contact_name) || !hasVal(rec.license_number)),
  async lookup(lead) { return resolveFromAzRecords(await fetchAzRocRecords(lead), lead); },
};

const ADAPTERS = { 'co-sos': coSosAdapter, 'co-dora': coDoraAdapter, 'az-roc': azRocAdapter };

// ═══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════

const _leadsCache = new Map();
function readLeadsFile(file) {
  if (!_leadsCache.has(file)) _leadsCache.set(file, JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8')));
  return _leadsCache.get(file);
}
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

async function main() {
  console.log('\nOwner Resolver' + `  [source: ${SOURCE}]` + (LIVE ? '  [LIVE]' : '  [DRY RUN — no writes]'));
  console.log('─'.repeat(64));

  const adapter = ADAPTERS[SOURCE];
  if (!adapter) { console.log(`Unknown --source "${SOURCE}". Supported: ${Object.keys(ADAPTERS).join(', ')}.`); return; }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const leadIndex = buildLeadIndex();

  // Eligible: mid-funnel, has business_name + city, and the adapter says so (geo/trade/missing-data).
  const candidates = [];
  let skippedStatus = 0, notSearchable = 0, notEligible = 0, noRecord = 0;
  for (const entry of state.queue) {
    if (SKIP_STATUSES.has(entry.status)) { skippedStatus++; continue; }
    const loc = leadIndex.get(entry.lead_id);
    if (!loc) { noRecord++; continue; }
    const rec = readLeadsFile(loc.file)[loc.idx];
    if (!hasVal(rec.business_name) || !hasVal(rec.city)) { notSearchable++; continue; }
    if (!adapter.eligible(rec)) { notEligible++; continue; }
    candidates.push({ entry, loc, rec });
  }

  console.log(`Queue: ${state.queue.length} leads`);
  console.log(`  skipped (sent/closed):        ${skippedStatus}`);
  console.log(`  not searchable (name/city):   ${notSearchable}`);
  console.log(`  out of ${SOURCE} scope:          ${notEligible}`);
  console.log(`  → eligible to resolve:        ${candidates.length}` + (LIMIT !== Infinity ? ` (capped at ${LIMIT})` : ''));
  console.log('─'.repeat(64));

  const todo = candidates.slice(0, LIMIT);
  let processed = 0, resolved = 0, enriched = 0, errors = 0;
  const dirtyFiles = new Set();
  const resolvedLeads = [];

  for (const c of todo) {
    processed++;
    let result;
    try {
      result = await adapter.lookup(c.rec);
    } catch (e) {
      errors++;
      console.log(`[${processed}/${todo.length}] ${c.rec.business_name} … error (${e.message})`);
      continue;
    }
    const gotOwner = result && hasVal(result.owner_name);
    const gotExtra = result && result.extra && Object.keys(result.extra).length > 0;
    if (!gotOwner && !gotExtra) {
      console.log(`[${processed}/${todo.length}] ${c.rec.business_name} … no confident match`);
      continue;
    }
    if (gotOwner) resolved++;
    if (gotExtra) enriched++;

    const pct = Math.round(result.confidence * 100);
    const bits = [];
    if (gotOwner) bits.push(`owner: ${result.owner_name}`);
    if (gotExtra && result.extra.license_number) bits.push(`lic ${result.extra.license_number} (${result.extra.license_status || '?'})`);
    console.log(`[${processed}/${todo.length}] ${c.rec.business_name} … ✓ ${bits.join('  ')}  (${pct}%, ${result.source})`);
    if (gotOwner) resolvedLeads.push({ business: c.rec.business_name, owner: result.owner_name, pct });

    if (!LIVE) continue;
    const rec = readLeadsFile(c.loc.file)[c.loc.idx];
    if (gotOwner && !hasVal(rec.contact_name)) {   // additive — never overwrite
      rec.contact_name = result.owner_name;
      rec.owner_source = result.source;
      rec.owner_confidence = result.confidence;
      if (result.profile.mailing) rec.owner_mailing_address = result.profile.mailing;
      rec.owner_resolved_at = new Date().toISOString();
      c.entry.ownerSource = result.source;
      c.entry.ownerResolvedAt = new Date().toISOString();
    }
    if (gotExtra) {                                // licensure fields (fill-if-empty)
      for (const [k, v] of Object.entries(result.extra)) if (!hasVal(rec[k])) rec[k] = v;
      rec.license_source = result.source;
    }
    dirtyFiles.add(c.loc.file);
  }

  if (LIVE) {
    for (const file of dirtyFiles) fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(readLeadsFile(file), null, 2));
    if (resolved > 0 || enriched > 0) fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(64));
  console.log('Summary');
  console.log(`  leads processed:      ${processed}`);
  console.log(`  owners resolved:      ${resolved}`);
  if (SOURCE === 'co-dora') console.log(`  licenses confirmed:   ${enriched}`);
  console.log(`  no match / errors:    ${processed - Math.max(resolved, enriched) - errors} / ${errors}`);
  if (resolvedLeads.length) {
    console.log('\nResolved owners:');
    for (const r of resolvedLeads) console.log(`  • ${r.business} → ${r.owner} (${r.pct}%)`);
  }
  if (!LIVE && (resolved > 0 || enriched > 0)) console.log('\n[dry-run] nothing written. Re-run with --live to save.');
  if (LIVE && resolved > 0) console.log('\nOwner names saved to contact_name — feed personalization (caller.js, DMs, drip) + email-permuter for has-website leads.');
  if (errors === processed && processed > 0) {
    const host = SOURCE === 'az-roc' ? 'azroc.my.site.com' : 'data.colorado.gov';
    console.log(`\n⚠  Every lookup errored. In the container this is expected (proxy blocks ${host}).`);
    console.log(`   Run on the Mac, or allowlist ${host}.`);
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

// Exported for unit testing (pure functions only — no network/I/O).
module.exports = {
  isRegisteredAgentService, titleCase, agentOwnerName, rowToProfile,
  nameOverlap, resolveFromCoRows, buildCoSosUrl,
  // co-dora
  tradeKey, doraTradeOf, doraPersonName, rowToDoraProfile, resolveFromDoraRows, buildCoDoraUrl,
  // az-roc
  personAfterLabel, parseAzRocProfileText, rowToAzProfile, resolveFromAzRecords,
};
