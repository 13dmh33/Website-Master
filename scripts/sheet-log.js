#!/usr/bin/env node
/**
 * Sheet-Log — sync sent-email leads to a Google Sheet CRM tab.
 *
 * Maintains a living CRM: every run updates existing rows in place (matched by
 * email address) and appends genuinely new leads. The Sheet always reflects the
 * current state — drip progress, reply status, unsubscribe flags.
 *
 * Columns A–N:
 *   company | email | trade | status | demo URL |
 *   email 1 sent | email 2 sent | email 3 sent | email 4 sent |
 *   last reply date | reply summary | unsubscribed | unsubscribe date | notes
 *
 * Drip column mapping (from messages/{id}-sent.json):
 *   email 1 → sent.email_sent_at            (initial pitcher send)
 *   email 2 → sent.drip.d1.email_sent_at    (day 4 soft check-in)
 *   email 3 → sent.drip.d1b.email_sent_at   (day 8 missed-call angle)
 *   email 4 → sent.drip.d1c.email_sent_at   (day 12 competitor visibility)
 *   (drip d2 / day-19 final touch is the 5th email — not tracked in the sheet)
 *
 * Reply data: read from messages/{id}-sent.json fields set by poller.js:
 *   sent.status ('positive' → replied), sent.replied_at, sent.reply_subject.
 *   Run `node scripts/poller.js` first to populate these. Until poller is
 *   running, the reply / reply-summary / last-reply-date columns stay blank.
 *
 * Unsubscribe: flagged when state.json entry.status === 'unsubscribed'
 *   OR messages sent.status === 'unsubscribed'. Set by reply-classifier via
 *   webhook.js (SMS STOP) or manually. See CHECKPOINT.md for CAN-SPAM requirement.
 *
 * Reads:  state.json | queue/{id}-brief.json | messages/{id}-sent.json | .env.local
 * Writes: Google Sheet (update-or-insert per lead) — nothing else
 *
 * Usage:
 *   node scripts/sheet-log.js            # sync all sent-email leads to the Sheet
 *   node scripts/sheet-log.js --dry-run  # show what would change; no writes
 *
 * Run after each: node scripts/pitcher.js --channel email
 *                 node scripts/drip.js
 *                 node scripts/poller.js
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

// ── Column definitions (A–N, 14 columns) ─────────────────────────────────────
const HEADER = [
  'company', 'email', 'trade', 'status', 'demo URL',
  'email 1 sent', 'email 2 sent', 'email 3 sent', 'email 4 sent',
  'last reply date', 'reply summary', 'unsubscribed', 'unsubscribe date', 'notes',
];
const NUM_COLS  = HEADER.length; // 14
const EMAIL_COL = 1;  // B (0-indexed) — unique key for update matching
const NOTES_COL = 13; // N (0-indexed) — Dave fills; preserved on every update
const COL_LAST  = 'N'; // 14th column letter

// Write to a dedicated tab so the curated-leads tab in the same spreadsheet is never touched.
const TAB         = process.env.SHEET_TAB || 'SentLog';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';

function quoteTab(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }
const HEADER_RANGE = `${quoteTab(TAB)}!A1:${COL_LAST}1`;
const APPEND_RANGE = `${quoteTab(TAB)}!A1`;
const ALL_RANGE    = `${quoteTab(TAB)}!A:${COL_LAST}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Was this lead sent via email? Prefer the messages/ record; fall back to brief+state. */
function wasEmailSent(leadId, brief) {
  const sent = readJsonSafe(path.join(MESSAGES_DIR, `${leadId}-sent.json`));
  if (sent && typeof sent.email_sent === 'boolean') return sent.email_sent === true;
  if (brief && brief.email && (brief.channel === 'email' || brief.secondary_channel === 'email')) return true;
  return false;
}

/**
 * Build the 14-column row for a lead.
 * existingNotes is read from the Sheet's N column and written back unchanged
 * so Dave's manual notes survive every update pass.
 */
function buildRow(entry, brief, sent, existingNotes = '') {
  const isUnsub   = entry.status === 'unsubscribed' || sent?.status === 'unsubscribed';
  const isReplied = entry.status === 'replied'       || sent?.status === 'positive';

  let status = 'sent';
  if (isUnsub)        status = 'unsubscribed';
  else if (isReplied) status = 'replied';

  // Initial email timestamp — prefer messages file; fall back to state.json sent_at
  const email1 = sent?.email_sent_at  || entry.sent_at || '';
  // Drip follow-up timestamps — only present after drip.js has sent that step
  const email2 = sent?.drip?.d1?.email_sent_at  || '';
  const email3 = sent?.drip?.d1b?.email_sent_at || '';
  const email4 = sent?.drip?.d1c?.email_sent_at || '';

  // Reply / unsubscribe timestamps
  const replyAt       = sent?.replied_at || entry.reply_received_at || '';
  const lastReplyDate = (isReplied || isUnsub) && replyAt ? replyAt.split('T')[0] : '';
  // reply_subject is the closest thing to a summary that poller stores (body is not saved)
  const replySummary  = (isReplied || isUnsub) ? (sent?.reply_subject || '') : '';
  const unsubDate     = isUnsub && replyAt ? replyAt.split('T')[0] : '';

  return [
    brief.business_name || entry.lead_id,  // A company
    brief.email || '',                       // B email (match key)
    brief.trade || '',                       // C trade
    status,                                  // D status
    brief.demo_url || '',                    // E demo URL
    email1,                                  // F email 1 sent
    email2,                                  // G email 2 sent
    email3,                                  // H email 3 sent
    email4,                                  // I email 4 sent
    lastReplyDate,                           // J last reply date
    replySummary,                            // K reply summary
    isUnsub ? 'TRUE' : 'FALSE',              // L unsubscribed
    unsubDate,                               // M unsubscribe date
    existingNotes,                           // N notes (preserved from Sheet)
  ];
}

// ── Google service-account auth (hand-rolled JWT → access token; zero extra deps) ──
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env.local — point it at your service-account key file (see CHECKPOINT.md).');
  }
  if (!fs.existsSync(credPath)) {
    throw new Error(`Service-account key file not found at: ${credPath} (check GOOGLE_SERVICE_ACCOUNT_JSON in .env.local).`);
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
  const claim  = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL,
    iat: now, exp: now + 3600,
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

// ── Sheets API helpers ────────────────────────────────────────────────────────
/** Fetch every row from the SentLog tab (header + data). */
async function sheetsGetAll(token, sheetId) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(ALL_RANGE)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets read failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

/** Append rows after the last populated row in the tab. */
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

/**
 * Update specific rows in a single API call.
 * data: [{ range: "'SentLog'!A5:N5", values: [[...]] }, ...]
 */
async function sheetsBatchUpdate(token, sheetId, data) {
  const url = `${SHEETS_BASE}/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!res.ok) throw new Error(`Sheets batchUpdate failed (HTTP ${res.status}): ${await res.text()}`);
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nSheet-Log' + (DRY_RUN ? '  [DRY RUN — nothing written]' : ''));
  console.log('─'.repeat(60));

  const state = readJsonSafe(STATE_PATH);
  if (!state || !Array.isArray(state.queue)) { console.error('Could not read state.json queue.'); process.exit(1); }

  // Collect every lead that was sent an email (any current pipeline status).
  // entry.sent_at is set by pitcher.js at initial send time; it's how we identify
  // "has been through pitcher" regardless of what status the lead is in now.
  let notEmail = 0, noBrief = 0;
  const pending = [];
  for (const entry of state.queue) {
    if (!entry.sent_at) continue; // never reached pitcher
    const brief = readJsonSafe(path.join(QUEUE_DIR, `${entry.lead_id}-brief.json`));
    if (!brief) { noBrief++; continue; }
    if (!wasEmailSent(entry.lead_id, brief)) { notEmail++; continue; }
    const sent = readJsonSafe(path.join(MESSAGES_DIR, `${entry.lead_id}-sent.json`));
    pending.push({ entry, brief, sent });
  }

  const neverSent = state.queue.filter(e => !e.sent_at).length;
  console.log(`email leads to sync: ${pending.length}`);
  console.log(`  skipped — never reached pitcher: ${neverSent}`);
  console.log(`  skipped — not an email send:    ${notEmail}`);
  console.log(`  skipped — no brief found:       ${noBrief}`);

  if (pending.length === 0) {
    console.log('\nNothing to sync. Done.');
    return;
  }

  if (DRY_RUN) {
    console.log('\nRows that WOULD be synced (↑ update / + append):');
    console.log('  ' + HEADER.join(' | '));
    for (const { entry, brief, sent } of pending) {
      const row = buildRow(entry, brief, sent);
      console.log('  ' + row.map(c => c === '' ? '—' : c).join(' | '));
    }
    console.log(`\n[dry-run] ${pending.length} row(s) not written.`);
    return;
  }

  // Real sync.
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) { console.error('SHEET_ID is not set in .env.local (the long id from the Sheet URL).'); process.exit(1); }

  let token;
  try {
    const sa = loadServiceAccount();
    token = await getAccessToken(sa);
  } catch (e) {
    console.error('\n✖ Google auth failed: ' + e.message);
    console.error('  Fix: confirm GOOGLE_SERVICE_ACCOUNT_JSON points to a valid key file (see CHECKPOINT.md).');
    process.exit(1);
  }

  try {
    // Ensure the dedicated tab exists (never touches other tabs in the file).
    const created = await ensureTab(token, sheetId);
    if (created) console.log(`Created tab "${TAB}".`);

    // Fetch all current rows to build email → row-number index.
    const allData     = await sheetsGetAll(token, sheetId);
    const existingRows = allData.values || [];

    // Detect where the notes column lives in the fetched data.
    // Old format (8-col): notes at index 7. New format (14-col): notes at index 13.
    // If the sheet was written by the previous version of this script, existingRows[0]
    // will be the old 8-column header; we find 'notes' wherever it actually sits.
    const headerRow      = existingRows[0] || [];
    const hasHeader      = headerRow.length > 0 && String(headerRow[0]).trim().length > 0;
    const notesColSource = headerRow.indexOf('notes'); // -1 if absent
    const effectiveNotes = notesColSource >= 0 ? notesColSource : NOTES_COL;

    // Build email → { sheetRow (1-based), existingNotes } lookup.
    const emailToRow = new Map();
    existingRows.forEach((row, i) => {
      if (i === 0) return; // skip header row
      const email = (row[EMAIL_COL] || '').trim().toLowerCase();
      if (email) emailToRow.set(email, { sheetRow: i + 1, existingNotes: row[effectiveNotes] || '' });
    });

    // Always refresh the header to the full 14-column set.
    await sheetsBatchUpdate(token, sheetId, [{ range: HEADER_RANGE, values: [HEADER] }]);
    if (!hasHeader) console.log('Wrote header row (sheet was empty).');
    else            console.log(`Refreshed header to ${NUM_COLS} columns.`);

    // Classify each lead as update (row exists) or append (new lead).
    const toUpdate = []; // { range, values: [row] }
    const toAppend = []; // [row]

    for (const { entry, brief, sent } of pending) {
      const emailKey = (brief.email || '').trim().toLowerCase();
      if (!emailKey) continue; // can't match without email

      if (emailToRow.has(emailKey)) {
        const { sheetRow, existingNotes } = emailToRow.get(emailKey);
        const row = buildRow(entry, brief, sent, existingNotes);
        toUpdate.push({
          range: `${quoteTab(TAB)}!A${sheetRow}:${COL_LAST}${sheetRow}`,
          values: [row],
        });
      } else {
        toAppend.push(buildRow(entry, brief, sent));
      }
    }

    // Batch-update existing rows in one API call, then append new ones.
    if (toUpdate.length > 0) await sheetsBatchUpdate(token, sheetId, toUpdate);
    if (toAppend.length > 0) await sheetsAppend(token, sheetId, toAppend);

    console.log('─'.repeat(60));
    console.log('Summary');
    console.log(`  rows updated:  ${toUpdate.length}`);
    console.log(`  rows appended: ${toAppend.length}`);
    console.log(`  total synced:  ${toUpdate.length + toAppend.length}`);
    console.log(`  errors:        0`);
    console.log('\nDone. Run again after drip.js / poller.js to pick up drip times and replies.');
  } catch (e) {
    console.error('\n✖ Could not sync with the Sheet: ' + e.message);
    console.error('  Most common cause: Sheet not shared with the service-account email (Editor access).');
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
