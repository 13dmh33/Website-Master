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
 * Writes: leads/*.json          (fills empty `email` on flipped leads;
 *                                --deep also fills empty `phone`, `contact_name`, `socials`)
 *         state.json            (status -> 'scouted', adds preScrapeStatus, scrapedEmailAt)
 *         Google Sheet          (--deep only — AllContacts tab, additive phone/email/socials)
 *
 * ── --deep mode (opt-in) ─────────────────────────────────────────────────────
 *   Default behaviour is UNCHANGED: homepage-only, extract public email, additive
 *   write, re-queue on a new email. `--deep` layers on top of that (never replaces it):
 *     • crawls up to 3 internal contact/about/team/staff/meet/our-story pages
 *     • respects robots.txt, throttles to ~1 req/sec, 10s timeout, realistic UA
 *     • also extracts phone (tel: + US regex), owner/contact name, and socials
 *       (facebook / instagram / linkedin), all written ADDITIVELY (fill-if-empty)
 *     • re-queue for re-diagnosis still triggers ONLY on a newly-found email —
 *       phone / name / socials alone never reset a lead's status
 *     • syncs the new values to the Google Sheet CRM (AllContacts tab)
 *
 * Usage:
 *   node scripts/contact-scraper.js              # real run (homepage only)
 *   node scripts/contact-scraper.js --dry-run    # find emails, write nothing
 *   node scripts/contact-scraper.js --limit 20   # cap sites visited this run
 *   node scripts/contact-scraper.js --deep       # deep crawl + full contact info + Sheet sync
 *   node scripts/contact-scraper.js --deep --dry-run --limit 5   # preview deep run, write nothing
 *
 * NOTE: Must be run on the Mac for real results. The container's outbound proxy
 *   only allowlists package registries + Anthropic, so arbitrary contractor sites
 *   return 403 here (same reason Scout runs on Mac). The --deep Sheet sync needs
 *   GOOGLE_SERVICE_ACCOUNT_JSON in .env.local (same creds as scripts/sheet-log.js).
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const LEADS_DIR  = path.join(ROOT, 'leads');

// ── flags ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const DEEP    = process.argv.includes('--deep');   // opt-in: deep crawl + full contact info + Sheet sync
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

// ── --deep tunables (only used when --deep is passed) ────────────────────────
const DEEP_CONTACT_HINTS = ['contact', 'about', 'team', 'staff', 'meet', 'our-story'];
const DEEP_REQ_DELAY_MS  = 1000;  // ~1 req/sec while crawling one site
const DEEP_MAX_PAGES     = 3;     // homepage + up to 3 matched contact-ish pages
const ALLCONTACTS_TAB    = 'AllContacts';
// Mirror of scripts/sheet-log.js AllContacts schema (socials appended by --deep sync)
const ALLCONTACTS_HEADER = [
  'company', 'trade', 'city', 'phone', 'email', 'website',
  'channel', 'status', 'rating', 'reviews', 'demo URL',
];

const TEL_RE      = /tel:\+?([0-9().\-\s]{7,})/gi;
const US_PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
const NAME_ROLES  = 'owner|founder|co-?founder|president|proprietor|principal|ceo';
// A capitalized 2–3 token human name (allows a middle initial)
const NAME_TOKEN  = "[A-Z][a-z]+(?:\\s+[A-Z]\\.?)?(?:\\s+[A-Z][a-z]+){1,2}";

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

// Placeholder strings Scout/imports use for "no website" — must NOT be treated as a URL.
const NO_SITE_VALUES = new Set(['none', 'n/a', 'na', 'null', 'nil', '-', '—', 'no website', 'n.a.']);
function websiteOf(rec) {
  const v = rec.site_url || rec.website || rec.site || null;
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || NO_SITE_VALUES.has(s)) return null;
  if (!s.includes('.')) return null; // not domain-shaped (e.g. stray "none")
  return v;
}

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

function findContactLinks(html, baseUrl, hints = CONTACT_HINTS) {
  const links = new Set();
  const aRe = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>(.*?)<\/a>/gis;
  let m;
  while ((m = aRe.exec(html))) {
    const href = m[1];
    const text = (m[2] || '').replace(/<[^>]+>/g, '');
    const hay = (href + ' ' + text).toLowerCase();
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) continue;
    if (hints.some(h => hay.includes(h))) {
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

// ── --deep extraction helpers (public contact-page info only) ────────────────
function stripTags(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize any US phone string → "+1 XXX-XXX-XXXX", or null if not a valid US number. */
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return null;
  if (!/[2-9]/.test(d[0]) || !/[2-9]/.test(d[3])) return null; // area + exchange can't start 0/1
  return `+1 ${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** All valid US phones on a page (tel: links first, then visible text). Deduped, order-stable. */
function extractPhones(html) {
  const found = new Set();
  let m;
  const telRe = new RegExp(TEL_RE.source, 'gi');
  while ((m = telRe.exec(html))) { const n = normalizePhone(m[1]); if (n) found.add(n); }
  const text = stripTags(html);
  const numRe = new RegExp(US_PHONE_RE.source, 'g');
  while ((m = numRe.exec(text))) { const n = normalizePhone(m[0]); if (n) found.add(n); }
  return [...found];
}

/** Reject obvious non-names captured by the role patterns. */
function cleanName(s) {
  const n = String(s || '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const tokens = n.split(' ');
  if (tokens.length < 2 || tokens.length > 3) return null;
  if (/\b(our|the|your|we|us|company|team|services?|plumbing|electric(?:al)?|heating|roofing|handyman|repair|about|home|contact|owner|founder|president|welcome)\b/i.test(n)) return null;
  return n;
}

/** Split HTML into text segments at tag boundaries so text from separate elements
 *  (e.g. a name in one tag and a "Call" link in the next) never merges into a fake name. */
function htmlToLines(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split(/\n+/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Best-effort owner/contact name from role-adjacent text. Conservative (returns null if unsure). */
function extractContactName(html) {
  const patterns = [
    new RegExp(`(?:${NAME_ROLES})\\s*[:\\-–,]?\\s*(${NAME_TOKEN})`, 'i'),
    new RegExp(`(${NAME_TOKEN})\\s*[,\\-–]\\s*(?:${NAME_ROLES})`, 'i'),
    new RegExp(`(?:meet|i'?m|i am|my name is)\\s+(${NAME_TOKEN})`, 'i'),
  ];
  const lines = htmlToLines(html);
  const tryLine = line => {
    for (const re of patterns) {
      const mm = line.match(re);
      if (mm && mm[1]) { const n = cleanName(mm[1]); if (n) return n; }
    }
    return null;
  };
  // Pass 1: each segment alone (a name can't run into adjacent link/nav text).
  for (const line of lines) { const n = tryLine(line); if (n) return n; }
  // Pass 2: role in one tag, name in the very next — join only adjacent pairs.
  for (let i = 0; i < lines.length - 1; i++) { const n = tryLine(`${lines[i]} ${lines[i + 1]}`); if (n) return n; }
  return null;
}

function pathSeg(url) { return url.pathname.replace(/^\/+|\/+$/g, '').split('/')[0].toLowerCase(); }
function cleanSocialUrl(url) { return (url.origin + url.pathname).replace(/\/+$/, ''); }

/** All well-formed URLs on `host` found in the HTML. */
function collectHostUrls(html, host) {
  const re = new RegExp(`https?:\\/\\/(?:www\\.|m\\.|business\\.)?${host.replace(/\./g, '\\.')}\\/[^\\s"'<>)\\]]+`, 'ig');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const raw = m[0].replace(/[)\]}>.,"']+$/, '');
    try { out.push(new URL(raw)); } catch { /* skip malformed */ }
  }
  return out;
}

/** { facebook?, instagram?, linkedin? } profile URLs, or null. First clean profile per network. */
function extractSocials(html) {
  const out = {};
  const FB_SKIP = ['sharer', 'share', 'plugins', 'tr', 'dialog', 'dialogs', 'login', 'watch', 'events', 'groups', 'sharer.php'];
  const IG_SKIP = ['p', 'explore', 'accounts', 'reel', 'reels', 'stories', 'tv', 'about', 'developer', 'legal'];
  for (const url of collectHostUrls(html, 'facebook.com')) {
    const seg = pathSeg(url);
    if (!seg || (seg.endsWith('.php') && seg !== 'profile.php') || FB_SKIP.includes(seg)) continue;
    out.facebook = cleanSocialUrl(url); break;
  }
  for (const url of collectHostUrls(html, 'instagram.com')) {
    const seg = pathSeg(url);
    if (!seg || IG_SKIP.includes(seg)) continue;
    out.instagram = cleanSocialUrl(url); break;
  }
  for (const url of collectHostUrls(html, 'linkedin.com')) {
    if (!['company', 'in', 'pub'].includes(pathSeg(url))) continue; // real profiles only
    out.linkedin = cleanSocialUrl(url); break;
  }
  return Object.keys(out).length ? out : null;
}

// ── robots.txt (deep mode is a polite crawler) ───────────────────────────────
async function fetchRobots(origin) {
  try {
    const res = await fetch(origin + '/robots.txt', {
      headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

/** Disallow paths that apply to `*` (and thus to us). Simplified but conservative. */
function parseDisallows(robotsTxt) {
  if (!robotsTxt) return [];
  const dis = [];
  let active = false;
  for (const raw of String(robotsTxt).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const ua = line.match(/^User-agent:\s*(.+)$/i);
    if (ua) { active = ua[1].trim() === '*'; continue; }
    const d = line.match(/^Disallow:\s*(.*)$/i);
    if (d && active && d[1].trim()) dis.push(d[1].trim());
  }
  return dis;
}

function isAllowed(disallows, urlPath) {
  for (const d of disallows) {
    if (d === '/') return false;
    const prefix = d.replace(/\*.*$/, '');           // treat wildcard as a prefix match
    if (prefix && urlPath.startsWith(prefix)) return false;
  }
  return true;
}

/**
 * Deep scrape: homepage + up to DEEP_MAX_PAGES contact-ish pages, robots-aware,
 * ~1 req/sec. Returns { email, phone, contact_name, socials }. Throws only when
 * the homepage itself is unreachable (mirrors scrapeSite — counted as an error).
 */
async function scrapeSiteDeep(siteUrl) {
  const base = /^https?:/i.test(siteUrl) ? siteUrl : 'http://' + siteUrl;
  const host = normHost(base);
  let homeUrl = base, html;
  try {
    html = await fetchText(base);
  } catch (e) {
    if (!/^https:/i.test(base)) { homeUrl = base.replace(/^http:/i, 'https:'); html = await fetchText(homeUrl); }
    else throw e;
  }

  const origin = (() => { try { return new URL(homeUrl).origin; } catch { return null; } })();
  const disallows = origin ? parseDisallows(await fetchRobots(origin)) : [];
  await sleep(DEEP_REQ_DELAY_MS);

  let emails  = extractEmails(html);
  let phones  = extractPhones(html);
  let name    = extractContactName(html);
  let socials = extractSocials(html) || {};

  const links = findContactLinks(html, homeUrl, DEEP_CONTACT_HINTS).slice(0, DEEP_MAX_PAGES);
  for (const sub of links) {
    let subPath = '/';
    try { subPath = new URL(sub).pathname; } catch { /* keep '/' */ }
    if (!isAllowed(disallows, subPath)) continue;
    try {
      const subHtml = await fetchText(sub);
      emails  = emails.concat(extractEmails(subHtml));
      phones  = phones.concat(extractPhones(subHtml));
      if (!name) name = extractContactName(subHtml);
      socials = { ...extractSocials(subHtml), ...socials }; // homepage findings win; new networks added
    } catch { /* one bad sub-page never aborts the site */ }
    await sleep(DEEP_REQ_DELAY_MS);
  }

  return {
    email:        pickBest(emails, host),
    phone:        [...new Set(phones)][0] || null,
    contact_name: name || null,
    socials:      Object.keys(socials).length ? socials : null,
  };
}

/** A1 column letter for a 0-based index (0→A, 26→AA). */
function colLetter(idx) {
  let s = '', n = idx + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Push discovered contact info to the Google Sheet CRM (AllContacts tab), additively:
 * existing rows only get their EMPTY phone/email/socials cells filled; unknown
 * companies are appended. A `socials` column is added if the tab lacks one.
 * Returns { updated, appended }. Throws on auth/network failure (caller warns, never crashes).
 */
async function syncToSheet(rows) {
  try { require('dotenv').config({ path: path.join(ROOT, '.env.local') }); } catch { /* dotenv optional */ }
  const gs = require('./lib/google-sheets');
  const sheetId = process.env.SHEET_ID || gs.DEFAULT_SHEET_ID;
  const token   = await gs.getAccessToken(gs.loadServiceAccount());
  await gs.ensureTab(token, sheetId, ALLCONTACTS_TAB);

  const grid   = await gs.sheetsGetAll(token, sheetId, ALLCONTACTS_TAB);
  const header = ((grid[0] && grid[0].length) ? grid[0].slice() : ALLCONTACTS_HEADER.slice()).map(h => String(h || ''));
  const findCol = name => header.findIndex(h => h.trim().toLowerCase() === name);

  let companyCol = findCol('company'); if (companyCol < 0) companyCol = 0;
  const phoneCol   = findCol('phone');
  const emailCol   = findCol('email');
  const websiteCol = findCol('website');
  let socialsCol   = findCol('socials');
  let headerChanged = false;
  if (socialsCol < 0) { socialsCol = header.length; header.push('socials'); headerChanged = true; }

  // Index existing rows by company name (first match wins).
  const rowByCompany = new Map();
  grid.slice(1).forEach((r, i) => {
    const key = String(r[companyCol] || '').trim().toLowerCase();
    if (key && !rowByCompany.has(key)) rowByCompany.set(key, { r, sheetRow: i + 2 }); // +2: header + 1-based
  });

  const socialsStr = s => Object.entries(s || {}).map(([k, v]) => `${k}: ${v}`).join(' | ');
  const cellUpdates = [];
  const appendRows  = [];

  for (const row of rows) {
    const key = String(row.company || '').trim().toLowerCase();
    const socialText = socialsStr(row.socials);
    const match = key ? rowByCompany.get(key) : null;
    if (match && match.sheetRow > 0) {
      const cur = match.r;
      const fillIfEmpty = (col, val) => {
        if (col < 0 || !val || String(cur[col] || '').trim()) return; // additive: never overwrite
        cellUpdates.push({ range: `${gs.quoteTab(ALLCONTACTS_TAB)}!${colLetter(col)}${match.sheetRow}`, values: [[val]] });
        cur[col] = val;
      };
      fillIfEmpty(phoneCol, row.phone);
      fillIfEmpty(emailCol, row.email);
      fillIfEmpty(socialsCol, socialText);
    } else if (!match) {
      const newRow = new Array(header.length).fill('');
      newRow[companyCol] = row.company || '';
      if (phoneCol   >= 0) newRow[phoneCol]   = row.phone   || '';
      if (emailCol   >= 0) newRow[emailCol]   = row.email   || '';
      if (websiteCol >= 0) newRow[websiteCol] = row.website || '';
      newRow[socialsCol] = socialText;
      appendRows.push(newRow);
      if (key) rowByCompany.set(key, { r: newRow, sheetRow: -1 }); // dedupe within this run
    }
  }

  if (headerChanged) {
    cellUpdates.unshift({ range: `${gs.quoteTab(ALLCONTACTS_TAB)}!A1:${colLetter(header.length - 1)}1`, values: [header] });
  }
  if (cellUpdates.length) await gs.sheetsBatchUpdate(token, sheetId, cellUpdates);
  if (appendRows.length)  await gs.sheetsAppend(token, sheetId, ALLCONTACTS_TAB, appendRows);
  return { updated: cellUpdates.length, appended: appendRows.length };
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
  console.log('\nContact-Page Scraper' + (DEEP ? '  [DEEP crawl]' : '') + (DRY_RUN ? '  [DRY RUN — no writes]' : ''));
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
  let phonesFound = 0, namesFound = 0, socialsFound = 0, leadsWithInfo = 0; // --deep only
  const flippedLeads = [];
  const errorLeads = [];
  const syncRows = [];             // --deep only — leads with new field data to push to the Sheet
  // batch writes per leads file so we read/modify/write each file once
  const fileEdits = new Map(); // file -> array (mutated in place)
  const hasVal = v => v && String(v).trim();
  const fileArr = file => {
    if (!fileEdits.has(file)) fileEdits.set(file, JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8')));
    return fileEdits.get(file);
  };

  for (const c of todo) {
    visited++;
    process.stdout.write(`[${visited}/${todo.length}] ${c.rec.business_name || c.entry.lead_id} … `);
    let result;
    try {
      result = DEEP ? await scrapeSiteDeep(c.site) : { email: await scrapeSite(c.site) };
    } catch (e) {
      errors++;
      errorLeads.push({ lead_id: c.entry.lead_id, site: c.site, error: e.message });
      console.log(`error (${e.message})`);
      await sleep(DELAY_MS);
      continue;
    }

    // ── default (homepage-only, email) path — behaviour unchanged ──
    if (!DEEP) {
      const email = result.email;
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
        const arr = fileArr(c.loc.file);
        if (!hasVal(arr[c.loc.idx].email)) {
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
      continue;
    }

    // ── --deep path: email + phone + name + socials, all additive ──
    const cur = c.rec;
    const newEmail = (result.email && !hasVal(cur.email)) ? result.email : null;
    const newPhone = (result.phone && !hasVal(cur.phone)) ? result.phone : null;
    const newName  = (result.contact_name && !hasVal(cur.contact_name)) ? result.contact_name : null;
    const curSocials = (cur.socials && typeof cur.socials === 'object') ? cur.socials : {};
    const addSocials = {};
    if (result.socials) {
      for (const [k, v] of Object.entries(result.socials)) if (!hasVal(curSocials[k])) addSocials[k] = v;
    }
    const hasNewSocials = Object.keys(addSocials).length > 0;

    if (newEmail) {
      found++; flipped++;
      flippedLeads.push({ lead_id: c.entry.lead_id, business: cur.business_name, email: newEmail, site: c.site });
    }
    if (newPhone) phonesFound++;
    if (newName) namesFound++;
    if (hasNewSocials) socialsFound++;

    // Per-lead line shows everything scraped (new or already-known), for visibility.
    const parts = [];
    if (result.email) parts.push(`✉ ${result.email}`);
    if (result.phone) parts.push(`☎ ${result.phone}`);
    if (result.contact_name) parts.push(`name: ${result.contact_name}`);
    if (result.socials) parts.push(`${Object.keys(result.socials).length} social`);
    if (parts.length) leadsWithInfo++;
    console.log(parts.length ? parts.join('  ') : 'no contact info found');

    const anyNew = newEmail || newPhone || newName || hasNewSocials;
    if (anyNew) {
      if (!DRY_RUN) {
        const rec = fileArr(c.loc.file)[c.loc.idx];
        if (newEmail) { rec.email = newEmail; rec.email_source = 'contact-scraper'; }
        if (newPhone) rec.phone = newPhone;
        if (newName)  rec.contact_name = newName;
        if (hasNewSocials) rec.socials = { ...curSocials, ...addSocials };
        rec.deep_enriched_at = new Date().toISOString();
        // Re-queue ONLY on a new email — phone/name/socials alone never rewind status.
        if (newEmail && entryNeedsRediagnose(c.entry)) {
          c.entry.preScrapeStatus = c.entry.status;
          c.entry.status = 'scouted';
          c.entry.scrapedEmailAt = new Date().toISOString();
        }
      }
      syncRows.push({
        company: cur.business_name || c.entry.lead_id,
        phone:   newPhone || cur.phone || '',
        email:   newEmail || cur.email || '',
        website: c.site || cur.website || '',
        socials: { ...curSocials, ...addSocials },
      });
    }
    await sleep(DELAY_MS);
  }

  // Leads-file writes happen whenever any record changed (default: only on flips;
  // --deep: also phone/name/socials). state.json is rewritten only when a re-queue occurred.
  if (!DRY_RUN && fileEdits.size > 0) {
    for (const [file, arr] of fileEdits) {
      fs.writeFileSync(path.join(LEADS_DIR, file), JSON.stringify(arr, null, 2));
    }
  }
  if (!DRY_RUN && flipped > 0) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  console.log('─'.repeat(60));
  console.log('Summary');
  console.log(`  sites visited:        ${visited}`);
  console.log(`  emails found:         ${found}`);
  if (DEEP) {
    console.log(`  phones found:         ${phonesFound}`);
    console.log(`  names found:          ${namesFound}`);
    console.log(`  socials found:        ${socialsFound}`);
  }
  console.log(`  leads flipped→email:  ${DRY_RUN ? 0 : flipped}${DRY_RUN ? `  (${flipped} would flip)` : ''}`);
  console.log(`  no email / unchanged: ${visited - found}`);
  console.log(`  fetch errors:         ${errors}`);
  if (DEEP) {
    const hitRate = visited ? Math.round((leadsWithInfo / visited) * 100) : 0;
    console.log(`  hit rate:             ${hitRate}%  (${leadsWithInfo}/${visited} sites yielded contact info)`);
  }
  if (flippedLeads.length) {
    console.log('\nFlipped to email:');
    for (const f of flippedLeads) console.log(`  • ${f.business || f.lead_id} → ${f.email}`);
  }
  if (!DRY_RUN && flipped > 0) {
    console.log('\nNext: node scripts/diagnoser.js  →  node scripts/checker.js  →  node scripts/pitcher.js --channel email');
  }

  // --deep: sync newly-found contact info to the Google Sheet CRM (AllContacts).
  if (DEEP && syncRows.length) {
    if (DRY_RUN) {
      console.log(`\n[dry-run] would sync ${syncRows.length} lead(s) to Google Sheet "${ALLCONTACTS_TAB}" (fills empty phone/email/socials):`);
      for (const r of syncRows) {
        const soc = Object.keys(r.socials || {});
        console.log(`  • ${r.company}` + (r.phone ? `  ☎ ${r.phone}` : '') + (r.email ? `  ✉ ${r.email}` : '') + (soc.length ? `  ${soc.join('/')}` : ''));
      }
    } else {
      try {
        const res = await syncToSheet(syncRows);
        console.log(`\n✓ Google Sheet "${ALLCONTACTS_TAB}" synced: ${res.updated} cell update(s), ${res.appended} row(s) appended.`);
      } catch (e) {
        console.log(`\n⚠  Google Sheet sync skipped: ${e.message}`);
        console.log('   (lead records were still written locally — re-run on the Mac with .env.local creds to sync.)');
      }
    }
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
module.exports = {
  extractEmails, isJunk, pickBest, findContactLinks, normHost, websiteOf,
  // --deep extractors
  stripTags, htmlToLines, normalizePhone, extractPhones, cleanName, extractContactName,
  extractSocials, parseDisallows, isAllowed, colLetter,
};
