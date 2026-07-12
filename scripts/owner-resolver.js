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
const dm   = require('./directory-scraper'); // reuse nameTokens/nameMatch/cityState/cityMatch/scoreMatch

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

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════════

const CO_SOS_RESOURCE = 'https://data.colorado.gov/resource/4ykn-tg5h.json';

/** SODA query URL: full-text search on the business name, capped. */
function buildCoSosUrl(lead, limit = 25) {
  return `${CO_SOS_RESOURCE}?$q=${encodeURIComponent(lead.business_name || '')}&$limit=${limit}`;
}

const _lastHit = new Map();
async function politeWait(host) {
  const last = _lastHit.get(host) || 0;
  const wait = last + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  _lastHit.set(host, Date.now());
}

async function fetchCoSosRows(lead) {
  const url = buildCoSosUrl(lead);
  await politeWait('data.colorado.gov');
  const headers = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** CO Secretary of State adapter — only applies to CO leads. */
const coSosAdapter = {
  id: 'co-sos',
  appliesTo: lead => dm.cityState(lead.city).state === 'co',
  async lookup(lead) {
    const rows = await fetchCoSosRows(lead);
    return resolveFromCoRows(rows, lead);
  },
};

const ADAPTERS = { 'co-sos': coSosAdapter };

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

  // Eligible: mid-funnel, no owner name yet, has business_name + city, adapter applies (geography).
  const candidates = [];
  let skippedStatus = 0, haveOwner = 0, notSearchable = 0, outOfScope = 0, noRecord = 0;
  for (const entry of state.queue) {
    if (SKIP_STATUSES.has(entry.status)) { skippedStatus++; continue; }
    const loc = leadIndex.get(entry.lead_id);
    if (!loc) { noRecord++; continue; }
    const rec = readLeadsFile(loc.file)[loc.idx];
    if (hasVal(rec.contact_name)) { haveOwner++; continue; }
    if (!hasVal(rec.business_name) || !hasVal(rec.city)) { notSearchable++; continue; }
    if (!adapter.appliesTo(rec)) { outOfScope++; continue; }
    candidates.push({ entry, loc, rec });
  }

  console.log(`Queue: ${state.queue.length} leads`);
  console.log(`  skipped (sent/closed):        ${skippedStatus}`);
  console.log(`  already have owner name:      ${haveOwner}`);
  console.log(`  not searchable (name/city):   ${notSearchable}`);
  console.log(`  out of ${SOURCE} scope (geo):     ${outOfScope}`);
  console.log(`  → eligible to resolve:        ${candidates.length}` + (LIMIT !== Infinity ? ` (capped at ${LIMIT})` : ''));
  console.log('─'.repeat(64));

  const todo = candidates.slice(0, LIMIT);
  let processed = 0, resolved = 0, errors = 0;
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
    if (!result) {
      console.log(`[${processed}/${todo.length}] ${c.rec.business_name} … no confident owner`);
      continue;
    }
    resolved++;
    const pct = Math.round(result.confidence * 100);
    console.log(`[${processed}/${todo.length}] ${c.rec.business_name} … ✓ ${result.owner_name}  (${pct}%, ${result.source})`);
    resolvedLeads.push({ business: c.rec.business_name, owner: result.owner_name, pct });

    if (!LIVE) continue;
    const rec = readLeadsFile(c.loc.file)[c.loc.idx];
    if (!hasVal(rec.contact_name)) {              // additive — never overwrite
      rec.contact_name = result.owner_name;
      rec.owner_source = result.source;
      rec.owner_confidence = result.confidence;
      if (result.profile.mailing) rec.owner_mailing_address = result.profile.mailing;
      rec.owner_resolved_at = new Date().toISOString();
      dirtyFiles.add(c.loc.file);
    }
    c.entry.ownerSource = result.source;
    c.entry.ownerResolvedAt = new Date().toISOString();
  }

  if (LIVE) {
    for (const file of dirtyFiles) fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(readLeadsFile(file), null, 2));
    if (resolved > 0) fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(64));
  console.log('Summary');
  console.log(`  leads processed:      ${processed}`);
  console.log(`  owners resolved:      ${resolved}`);
  console.log(`  no match / errors:    ${processed - resolved - errors} / ${errors}`);
  if (resolvedLeads.length) {
    console.log('\nResolved owners:');
    for (const r of resolvedLeads) console.log(`  • ${r.business} → ${r.owner} (${r.pct}%)`);
  }
  if (!LIVE && resolved > 0) console.log('\n[dry-run] nothing written. Re-run with --live to save owner names.');
  if (LIVE && resolved > 0) console.log('\nOwner names saved to contact_name — feed personalization (caller.js, DMs, drip) + email-permuter for has-website leads.');
  if (errors === processed && processed > 0) {
    console.log('\n⚠  Every lookup errored. In the container this is expected (proxy blocks data.colorado.gov).');
    console.log('   Run on the Mac, or allowlist data.colorado.gov.');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

// Exported for unit testing (pure functions only — no network/I/O).
module.exports = {
  isRegisteredAgentService, titleCase, agentOwnerName, rowToProfile,
  nameOverlap, resolveFromCoRows, buildCoSosUrl,
};
