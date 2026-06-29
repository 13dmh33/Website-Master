#!/usr/bin/env node
/**
 * Sheet-Log — append a row to a Google Sheet for every lead that was sent an email.
 *
 * Turns the Google Sheet into a simple CRM / sent-log. One-way append only:
 * what went out. Dave reads replies in Zoho and fills the reply/notes columns by
 * hand. (Two-way reply sync is intentionally out of scope.)
 *
 * New file only — no existing pipeline file is modified.
 *
 * Reads:  state.json            (leads with status 'sent' — how pitcher.js marks a send)
 *         messages/{id}-sent.json (confirms it was an EMAIL send: email_sent === true)
 *         queue/{id}-brief.json  (company, trade, email, demo_url)
 *         .env.local            (GOOGLE_SERVICE_ACCOUNT_JSON, SHEET_ID, optional SHEET_TAB)
 * Writes: the Google Sheet      (append one row per newly-sent email lead)
 *         state.json            (adds loggedToSheet:true to logged leads — additive)
 *
 * Usage:
 *   node scripts/sheet-log.js            # append new sent-email leads to the Sheet
 *   node scripts/sheet-log.js --dry-run  # show the rows that WOULD be appended; no Sheet/state writes
 *
 * Run after each:  node scripts/pitcher.js --channel email
 *
 * Auth: a Google Cloud service account (no interactive OAuth). See CHECKPOINT.md for
 * the numbered setup steps. Credentials path + Sheet ID come from env vars, never hardcoded.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT         = path.join(__dirname, '..');
const STATE_PATH   = path.join(ROOT, 'state.json');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');

const DRY_RUN = process.argv.includes('--dry-run');

const HEADER = ['company', 'email', 'trade', 'status', 'demo URL', 'sent date', 'reply', 'notes'];
// Write to a dedicated tab so the curated-leads tab in the same spreadsheet is never touched.
const TAB = process.env.SHEET_TAB || 'SentLog';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// A1 ranges that reference a tab must quote the tab name (escape ' as '').
function quoteTab(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }
const TAB_RANGE = `${quoteTab(TAB)}!A1:H1`;  // header range (8 columns) within the tab
const APPEND_RANGE = `${quoteTab(TAB)}!A1`;  // append finds the first empty row in the tab

// ── helpers ───────────────────────────────────────────────────────────────────
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Was this lead sent via email? Prefer the messages/ record; fall back to brief+state. */
function wasEmailSent(leadId, brief) {
  const sent = readJsonSafe(path.join(MESSAGES_DIR, `${leadId}-sent.json`));
  if (sent && typeof sent.email_sent === 'boolean') return sent.email_sent === true;
  // No messages file (it's gitignored / may be absent): treat a 'sent' lead that had an
  // email and an email channel as an email send.
  if (brief && brief.email && (brief.channel === 'email' || brief.secondary_channel === 'email')) return true;
  return false;
}

function sentDateFor(leadId, stateEntry) {
  const sent = readJsonSafe(path.join(MESSAGES_DIR, `${leadId}-sent.json`));
  const iso = (sent && (sent.email_sent_at || sent.sent_at)) || (stateEntry && stateEntry.sent_at) || new Date().toISOString();
  return String(iso).split('T')[0];
}

// ── Google service-account auth (hand-rolled JWT → access token; zero extra deps) ─
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env.local — point it at your service-account key file (see CHECKPOINT.md).');
  }
  if (!fs.existsSync(credPath)) {
    throw new Error(`Service-account key file not found at: ${credPath} (check the GOOGLE_SERVICE_ACCOUNT_JSON path in .env.local).`);
  }
  const sa = readJsonSafe(credPath);
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new Error('Service-account key file is missing client_email/private_key — re-download the JSON key from Google Cloud.');
  }
  return sa;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (HTTP ${res.status}): ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Google token exchange returned no access_token.');
  return json.access_token;
}

async function sheetsGet(token, sheetId, range) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets read failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

async function sheetsAppend(token, sheetId, rows) {
  const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(APPEND_RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

/** List existing tab titles in the spreadsheet. */
async function listTabs(token, sheetId) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read spreadsheet tabs (HTTP ${res.status}): ${await res.text()}`);
  const json = await res.json();
  return (json.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
}

/** Create the target tab if it's not already there (leaves all other tabs untouched). */
async function ensureTab(token, sheetId) {
  const tabs = await listTabs(token, sheetId);
  if (tabs.includes(TAB)) return false;
  const res = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  if (!res.ok) throw new Error(`Could not create tab "${TAB}" (HTTP ${res.status}): ${await res.text()}`);
  return true;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nSheet-Log' + (DRY_RUN ? '  [DRY RUN — nothing written]' : ''));
  console.log('─'.repeat(60));

  const state = readJsonSafe(STATE_PATH);
  if (!state || !Array.isArray(state.queue)) { console.error('Could not read state.json queue.'); process.exit(1); }

  // Find sent-email leads not yet logged.
  let alreadyLogged = 0, notEmail = 0, noBrief = 0;
  const pending = [];
  for (const entry of state.queue) {
    if (entry.status !== 'sent') continue;
    if (entry.loggedToSheet === true) { alreadyLogged++; continue; }
    const brief = readJsonSafe(path.join(QUEUE_DIR, `${entry.lead_id}-brief.json`));
    if (!brief) { noBrief++; continue; }
    if (!wasEmailSent(entry.lead_id, brief)) { notEmail++; continue; }
    pending.push({ entry, brief });
  }

  console.log(`sent leads not yet logged & sent via email: ${pending.length}`);
  console.log(`  skipped — already logged: ${alreadyLogged}`);
  console.log(`  skipped — not an email send: ${notEmail}`);
  console.log(`  skipped — no brief found: ${noBrief}`);

  if (pending.length === 0) {
    console.log('\nNothing to append. Done.');
    return;
  }

  // Build rows in the fixed column order.
  const rows = pending.map(({ entry, brief }) => ([
    brief.business_name || entry.lead_id,         // company
    brief.email || '',                            // email
    brief.trade || '',                            // trade
    'sent',                                       // status
    brief.demo_url || '',                         // demo URL
    sentDateFor(entry.lead_id, entry),            // sent date (ISO date)
    '',                                           // reply (Dave fills)
    '',                                           // notes (Dave fills)
  ]));

  if (DRY_RUN) {
    console.log('\nRows that WOULD be appended:');
    console.log('  ' + HEADER.join(' | '));
    for (const r of rows) console.log('  ' + r.map(c => c === '' ? '—' : c).join(' | '));
    console.log(`\n[dry-run] ${rows.length} row(s) not written; state.json untouched.`);
    return;
  }

  // Real append.
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) { console.error('SHEET_ID is not set in .env.local (the long id from the Sheet URL).'); process.exit(1); }

  let token;
  try {
    const sa = loadServiceAccount();
    token = await getAccessToken(sa);
  } catch (e) {
    console.error('\n✖ Google auth failed: ' + e.message);
    console.error('  Fix: confirm GOOGLE_SERVICE_ACCOUNT_JSON points to a valid key file (see CHECKPOINT.md steps 1–4).');
    process.exit(1);
  }

  try {
    // Make sure the dedicated tab exists (never touches other tabs in the file).
    const created = await ensureTab(token, sheetId);
    if (created) console.log(`Created tab "${TAB}".`);
    // Write the header row first if the tab has none yet.
    const head = await sheetsGet(token, sheetId, TAB_RANGE);
    const hasHeader = Array.isArray(head.values) && head.values.length > 0 && head.values[0].length > 0;
    if (!hasHeader) {
      await sheetsAppend(token, sheetId, [HEADER]);
      console.log('Wrote header row (sheet was empty).');
    }
    await sheetsAppend(token, sheetId, rows);
  } catch (e) {
    console.error('\n✖ Could not write to the Sheet: ' + e.message);
    console.error('  Most common cause: the Sheet is not shared with the service-account email.');
    console.error('  Fix: open the Sheet → Share → paste the service account\'s client_email → give Editor access.');
    console.error('  (No rows were appended and state.json was NOT marked, so a re-run is safe.)');
    process.exit(1);
  }

  // Mark logged (additive) only after a successful append.
  for (const { entry } of pending) entry.loggedToSheet = true;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  console.log('─'.repeat(60));
  console.log('Summary');
  console.log(`  rows appended:        ${rows.length}`);
  console.log(`  skipped (already logged): ${alreadyLogged}`);
  console.log(`  errors:               0`);
  console.log('\nDone. Fill the reply/notes columns by hand as replies come into Zoho.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
