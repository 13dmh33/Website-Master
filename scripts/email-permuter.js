#!/usr/bin/env node
/**
 * Email Permuter — derive an owner's business email from {name + domain}, free.
 *
 * The no-Apollo replacement for the EMAIL step. Given a lead that already has an
 * owner name (a person — e.g. filled by contact-scraper --deep's contact_name, or
 * a future owner-resolver) and a website domain, it generates the standard set of
 * B2B email patterns, gates them against the domain's MX records, and (optionally)
 * verifies mailbox existence via a pluggable free-tier verification API. State-
 * agnostic: works on any lead nationwide with no per-state code.
 *
 * WHY the conservative default (read before editing):
 *   A permuted address is a GUESS. Writing a wrong guess into lead.email and
 *   flipping the lead to outreach means emailing the wrong person / bouncing and
 *   burning sender reputation. So by default this NEVER promotes a guess to
 *   lead.email and NEVER re-diagnoses. It stages ranked candidates on the record
 *   (email_candidates) for review. A candidate is promoted to lead.email (with
 *   re-diagnosis, same contract as contact-scraper) ONLY when it clears a real
 *   check: --verify (mailbox confirmed via the verify API) or an explicit
 *   --trust-mx (accept the top MX-gated pattern — use only for corporate domains).
 *
 *   Honest limits (see the scoping notes): true SMTP RCPT verification needs
 *   outbound port 25, which is blocked in the container AND on most residential
 *   Mac ISPs; ~18% of domains are catch-all (probe always says yes); Gmail
 *   obscures mailbox existence. MX-gating proves the DOMAIN accepts mail, not that
 *   the specific mailbox exists. Set EMAIL_VERIFY_URL to a free-tier verifier
 *   (e.g. Email Hippo ~100/day) for real mailbox checks.
 *
 * Reads:  state.json, leads/*.json (contact_name + website + email)
 * Writes: leads/*.json  (email_candidates always in --live; email + email_source +
 *                        email_confidence only when a candidate is verified/trusted)
 *         state.json    (re-diagnose flip only on a promoted email)
 *
 * Usage:
 *   node scripts/email-permuter.js                # DRY RUN — show ranked guesses + MX
 *   node scripts/email-permuter.js --live         # stage candidates on records (no promote)
 *   node scripts/email-permuter.js --live --verify # promote+requeue mailboxes the API confirms
 *   node scripts/email-permuter.js --live --trust-mx # promote top MX-gated guess (corp domains)
 *   node scripts/email-permuter.js --limit 20
 *
 * Env (optional): EMAIL_VERIFY_URL (GET, {email} substituted or ?email=), EMAIL_VERIFY_KEY.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const dns  = require('dns').promises;
const se   = require('./lib/social-extractor'); // shared websiteOf/normHost

const ROOT       = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');

function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const LIVE     = process.argv.includes('--live') || process.env.EMAIL_PERMUTE_LIVE === '1';
const VERIFY   = process.argv.includes('--verify');
const TRUST_MX = process.argv.includes('--trust-mx');
const LIMIT    = parseInt(getArg('--limit'), 10) || Infinity;

const SKIP_STATUSES = new Set(['sent', 'closed']);
const hasVal = v => v && String(v).trim();

// Domains where a guess is worthless (personal mailboxes — no per-owner pattern).
const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
  'live.com', 'msn.com', 'comcast.net', 'sbcglobal.net', 'me.com', 'protonmail.com',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// PURE LOGIC (no I/O) — exported for tests
// ═══════════════════════════════════════════════════════════════════════════════

const TITLES   = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mr.', 'mrs.', 'ms.', 'dr.']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'jr.', 'sr.']);

/** "Mr. John A. Smith Jr." → { first:'john', last:'smith' }, or null if not a 2-part human name. */
function parsePersonName(full) {
  const raw = String(full || '')
    .replace(/[.,]/g, ' ')                 // drop punctuation (incl. middle-initial dots)
    .replace(/[^A-Za-z\s'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  let tokens = raw.split(' ')
    .filter(t => t && !TITLES.has(t) && !SUFFIXES.has(t))
    .filter(t => t.length > 1 || /^[a-z]$/.test(t) === false); // drop lone middle initials
  tokens = tokens.filter(t => t.length > 1);
  if (tokens.length < 2) return null;
  return { first: tokens[0], last: tokens[tokens.length - 1] };
}

/** Localpart-safe token: strip apostrophes/hyphens → "o'brien" → "obrien". */
function lp(s) { return String(s).replace(/[^a-z0-9]/gi, '').toLowerCase(); }

/**
 * Ranked email candidates for a person at a domain (most → least common SMB pattern).
 * @returns {Array<{ email, pattern, rank }>}  rank 0 = most likely.
 */
function permutations(name, domain) {
  const p = parsePersonName(name);
  const d = String(domain || '').toLowerCase().replace(/^@/, '');
  if (!p || !d) return [];
  const f = lp(p.first), l = lp(p.last);
  if (!f || !l) return [];
  const locals = [
    `${f}.${l}`,   // john.smith   — most common at real businesses
    `${f}`,        // john
    `${f[0]}${l}`, // jsmith
    `${f}${l[0]}`, // johns
    `${f}_${l}`,   // john_smith
    `${f}${l}`,    // johnsmith
    `${l}`,        // smith
    `${l}.${f}`,   // smith.john
  ];
  const seen = new Set();
  const out = [];
  locals.forEach((local, rank) => {
    if (seen.has(local)) return;
    seen.add(local);
    out.push({ email: `${local}@${d}`, pattern: local, rank });
  });
  return out;
}

/** Domain of a website/URL string → bare host (reuses the shared extractor). null if none. */
function domainOf(rec) {
  const site = se.websiteOf(rec);
  return site ? se.normHost(site) : null;
}

/** True for the big consumer mail hosts where per-owner guessing is pointless. */
function isFreeMailDomain(domain) { return FREE_MAIL.has(String(domain || '').toLowerCase()); }

/** Confidence 0–1 for a chosen candidate given what we could confirm. */
function confidenceFor({ rank, mx, verified }) {
  if (verified) return 0.95;
  if (mx) return rank === 0 ? 0.5 : Math.max(0.3, 0.5 - rank * 0.04);
  return 0.15; // no MX even — domain may not accept mail at all
}

// ═══════════════════════════════════════════════════════════════════════════════
// I/O LAYER
// ═══════════════════════════════════════════════════════════════════════════════

/** Does the domain accept mail? (MX present, or an A record as SMTP fallback.) DNS only — works anywhere. */
async function hasMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch { /* fall through to A-record check */ }
  try { const a = await dns.resolve(domain); return !!(a && a.length); } catch { return false; }
}

/**
 * Optional mailbox verification via a free-tier API. Configure EMAIL_VERIFY_URL
 * (use {email} placeholder, or it's appended as ?email=). Returns true/false/null
 * (null = couldn't determine / not configured). Never throws.
 */
async function verifyMailbox(email) {
  const base = process.env.EMAIL_VERIFY_URL;
  if (!base) return null;
  try {
    const url = base.includes('{email}')
      ? base.replace('{email}', encodeURIComponent(email))
      : base + (base.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(email);
    const headers = process.env.EMAIL_VERIFY_KEY ? { Authorization: `Bearer ${process.env.EMAIL_VERIFY_KEY}` } : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body) return null;
    // Tolerant of common verifier response shapes.
    const status = String(body.result || body.status || body.state || body.deliverability || '').toLowerCase();
    if (/valid|deliverable|ok|exist/.test(status) && !/undeliverable|invalid/.test(status)) return true;
    if (/invalid|undeliverable|reject|fail|no_?mailbox/.test(status)) return false;
    if (typeof body.valid === 'boolean') return body.valid;
    return null;
  } catch { return null; }
}

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
function entryNeedsRediagnose(entry) { return !SKIP_STATUSES.has(entry.status); }

async function main() {
  const mode = VERIFY ? 'verify' : (TRUST_MX ? 'trust-mx' : 'stage-only');
  console.log('\nEmail Permuter' + (LIVE ? `  [LIVE — ${mode}]` : '  [DRY RUN]'));
  console.log('─'.repeat(64));

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const leadIndex = buildLeadIndex();

  // Eligible: mid-funnel, no email yet, has an owner NAME + a real (non-freemail) domain.
  const candidates = [];
  let skippedStatus = 0, hasEmail = 0, noName = 0, noDomain = 0, freeMail = 0, noRecord = 0;
  for (const entry of state.queue) {
    if (SKIP_STATUSES.has(entry.status)) { skippedStatus++; continue; }
    const loc = leadIndex.get(entry.lead_id);
    if (!loc) { noRecord++; continue; }
    const rec = readLeadsFile(loc.file)[loc.idx];
    if (hasVal(rec.email)) { hasEmail++; continue; }
    if (!hasVal(rec.contact_name) || !parsePersonName(rec.contact_name)) { noName++; continue; }
    const domain = domainOf(rec);
    if (!domain) { noDomain++; continue; }
    if (isFreeMailDomain(domain)) { freeMail++; continue; }
    candidates.push({ entry, loc, rec, domain });
  }

  console.log(`Queue: ${state.queue.length} leads`);
  console.log(`  skipped (sent/closed):     ${skippedStatus}`);
  console.log(`  already have email:        ${hasEmail}`);
  console.log(`  no owner name:             ${noName}`);
  console.log(`  no business domain:        ${noDomain}`);
  console.log(`  freemail domain (skip):    ${freeMail}`);
  console.log(`  → eligible to permute:     ${candidates.length}` + (LIMIT !== Infinity ? ` (capped at ${LIMIT})` : ''));
  console.log('─'.repeat(64));

  const todo = candidates.slice(0, LIMIT);
  let staged = 0, promoted = 0, noMx = 0;
  const dirtyFiles = new Set();
  const promotedLeads = [];

  for (const c of todo) {
    const cands = permutations(c.rec.contact_name, c.domain);
    if (!cands.length) continue;
    const mx = await hasMx(c.domain);
    if (!mx) noMx++;

    // Decide whether any candidate can be PROMOTED to lead.email.
    let promote = null; // { email, pattern, verified }
    if (mx && VERIFY) {
      for (const cand of cands) {
        const ok = await verifyMailbox(cand.email);
        if (ok === true) { promote = { ...cand, verified: true }; break; }
        if (ok === false) continue;
        // null (unknown) → keep looking; don't promote an unknown under --verify
      }
    } else if (mx && TRUST_MX) {
      promote = { ...cands[0], verified: false }; // top pattern, MX-gated
    }

    const conf = confidenceFor({ rank: (promote || cands[0]).rank, mx, verified: !!(promote && promote.verified) });
    const rankedList = cands.map(x => x.email);

    const line = `${c.rec.business_name} <${c.domain}>  mx:${mx ? 'yes' : 'NO'}  → ${(promote ? promote.email : cands[0].email)}`;
    console.log(promote ? `✓ ${line}  [PROMOTE ${promote.verified ? 'verified' : 'mx-trust'} ${Math.round(conf * 100)}%]`
                        : `· ${line}  [stage ${cands.length} guesses]`);

    if (!LIVE) continue;

    const rec = readLeadsFile(c.loc.file)[c.loc.idx];
    rec.email_candidates = rankedList;          // always staged in --live
    rec.email_permuted_at = new Date().toISOString();
    dirtyFiles.add(c.loc.file);
    staged++;

    if (promote) {
      rec.email = promote.email;
      rec.email_source = promote.verified ? 'permuted-verified' : 'permuted-mx';
      rec.email_confidence = conf;
      promoted++;
      promotedLeads.push({ business: c.rec.business_name, email: promote.email });
      if (entryNeedsRediagnose(c.entry)) {
        c.entry.preScrapeStatus = c.entry.status;
        c.entry.status = 'scouted';
        c.entry.scrapedEmailAt = new Date().toISOString();
      }
    }
  }

  if (LIVE) {
    for (const file of dirtyFiles) fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(readLeadsFile(file), null, 2));
    if (promoted > 0) fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(64));
  console.log('Summary');
  console.log(`  leads processed:      ${todo.length}`);
  console.log(`  candidates staged:    ${LIVE ? staged : 0}`);
  console.log(`  promoted to email:    ${promoted}` + (VERIFY ? ' (verified)' : TRUST_MX ? ' (mx-trust)' : ' (stage-only mode)'));
  console.log(`  domains w/o MX:       ${noMx}`);
  if (promotedLeads.length) {
    console.log('\nPromoted (will re-diagnose):');
    for (const p of promotedLeads) console.log(`  • ${p.business} → ${p.email}`);
  }
  if (!VERIFY && !TRUST_MX) {
    console.log('\nStage-only: guesses saved to email_candidates for review. Nothing promoted to outreach.');
    console.log('Promote with --verify (needs EMAIL_VERIFY_URL) or --trust-mx (corporate domains only).');
  } else if (promoted > 0) {
    console.log('\nNext: node scripts/diagnoser.js → checker.js → pitcher.js --channel email');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

module.exports = {
  parsePersonName, lp, permutations, domainOf, isFreeMailDomain, confidenceFor,
};
