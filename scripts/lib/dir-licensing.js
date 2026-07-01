/**
 * dir-licensing — state contractor-licensing-board adapter for directory-scout.
 *
 * Reality check that shapes this adapter: every state board has a different
 * site, and almost none of them are a clean HTML scrape — but nearly all let
 * you export search results as CSV/XLSX (Texas TDLR, Colorado DORA, Utah DOPL,
 * California CSLB, etc.). And they publish name/phone/address/license — rarely a
 * website. So the honest, state-agnostic design is a CSV INGESTER, not a live
 * scraper:
 *
 *   1. On the board's site, search "<trade> licenses in <city/county>".
 *   2. Export the results to CSV (every board above supports this).
 *   3. node scripts/directory-scout.js --source licensing --file <that.csv> \
 *        --trade plumber --city "Austin, TX"
 *
 * Column headers vary wildly between states, so mapping is FUZZY: we match by
 * normalized header substring (e.g. any header containing "company"/"business"/
 * "name" → business_name). Emails, when a board includes them, feed the pipeline
 * directly; otherwise the lead is name+phone+address → routed to needs-email for
 * Apollo/manual (licensing data's main value is a verified, ToS-clean roster of
 * every licensed contractor — not websites).
 *
 * parseListings is PURE (CSV text in, array out) and unit-tested against a
 * fixture. It is state-agnostic; no per-state code. Add a new state by exporting
 * its CSV — no code change.
 */

'use strict';

const SOURCE = 'licensing';

// This source has no live URL — it ingests a local CSV file. The runner detects
// the empty URL list and switches to --file mode. Kept for adapter-interface
// symmetry with dir-yellowpages / dir-bbb.
function buildSearchUrls() { return []; }

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop trailing all-empty rows
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, '');

// header-substring → field. First match wins, checked in order.
const FIELD_HINTS = [
  ['email',        ['email', 'emailaddress', 'e-mail']],
  ['site_url',     ['website', 'weburl', 'url', 'webaddress']],
  ['phone',        ['phone', 'telephone', 'phonenumber', 'businessphone']],
  ['business_name',['companyname', 'businessname', 'company', 'business', 'dba', 'legalname', 'licensee', 'name']],
  ['address',      ['address', 'streetaddress', 'mailingaddress', 'location']],
];

function buildColumnMap(headerRow) {
  const normed = headerRow.map(norm);
  const map = {};
  for (const [field, hints] of FIELD_HINTS) {
    for (const hint of hints) {
      const idx = normed.findIndex(h => h.includes(hint));
      if (idx >= 0 && !Object.values(map).includes(idx)) { map[field] = idx; break; }
    }
  }
  return map;
}

/** PURE: CSV text → array of rawListings. Empty/headerless input → []. */
function parseListings(csvText) {
  if (!csvText || !csvText.trim()) return [];
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const map = buildColumnMap(rows[0]);
  if (map.business_name == null) return []; // can't identify businesses → nothing usable

  const cell = (row, field) => (map[field] != null ? (row[map[field]] || '').trim() : '');
  return rows.slice(1).map(row => {
    const business_name = cell(row, 'business_name');
    if (!business_name) return null;
    return {
      business_name,
      email:   cell(row, 'email'),
      site_url: cell(row, 'site_url'),
      phone:   cell(row, 'phone'),
      address: cell(row, 'address'),
      rating: 0,
      review_count: 0,
    };
  }).filter(Boolean);
}

module.exports = { SOURCE, buildSearchUrls, parseListings, parseCsv, buildColumnMap };
