#!/usr/bin/env node
/**
 * Sheet-Log v3 — keeps a Google Sheet as a living CRM for email outreach
 *
 * Layout: 16 columns (A–P) + a ChangeLog tab for every create/update.
 *
 *  A  company           D  last send (email title)   H  email 1 sent
 *  B  email             E  date updated (auto)        I  email 2 sent
 *  C  trade             F  status  ← user-editable    J  email 3 sent
 *                       G  demo URL                   K  email 4 sent
 *                                                     L  last reply date
 *                                                     M  reply summary
 *                                                     N  unsubscribed
 *                                                     O  unsubscribe date
 *                                                     P  notes ← user-editable
 *
 * Column F (status) allowed values: sent / replied / quoted / customer / lost / do not contact
 * Columns F and P are PRESERVED on every update — never overwritten by the script.
 *
 * ChangeLog tab (append-only ledger):
 *   A  timestamp | B  action | C  company | D  email | E  change
 *   Only appended when something meaningful changes (new drip, reply, unsub, new row).
 *
 * Usage:
 *   node scripts/sheet-log.js            # sync all email leads to Sheet
 *   node scripts/sheet-log.js --dry-run  # preview rows; nothing written
 *
 * Reads:  state.json  queue/*-brief.json  messages/*-sent.json  .env.local
 * Writes: Google Sheet (SentLog + ChangeLog tabs) — state.json NOT modified
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

// ── Column schema ─────────────────────────────────────────────────────────────
const HEADER = [
  'company',          // A  0
  'email',            // B  1
  'trade',            // C  2
  'last send',        // D  3  most-recent email title
  'date updated',     // E  4  today's date — set every sync
  'status',           // F  5  user-editable
  'demo URL',         // G  6
  'email 1 sent',     // H  7  initial outreach date
  'email 2 sent',     // I  8  drip d1
  'email 3 sent',     // J  9  drip d1b
  'email 4 sent',     // K  10 drip d1c
  'last reply date',  // L  11
  'reply summary',    // M  12 subject line of last reply
  'unsubscribed',     // N  13 TRUE / FALSE
  'unsubscribe date', // O  14
  'notes',            // P  15 user-editable
];
const COL = Object.fromEntries(HEADER.map((h, i) => [h, i]));

const TAB           = process.env.SHEET_TAB || 'SentLog';
const CHANGELOG_TAB = 'ChangeLog';
const CHANGELOG_HEADER = ['timestamp', 'action', 'company', 'email', 'change'];
const SHEETS_BASE   = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL     = 'https://oauth2.googleapis.com/token';
const SCOPE         = 'https://www.googleapis.com/auth/spreadsheets';

function quoteTab(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

// ── Email title labels ────────────────────────────────────────────────────────
// Mirrors config/templates.json subjects (variables shown as-is for readability)
const DRIP_LABELS = {
  d1:  'Do you actually need a website if referrals keep you busy?',
  d1b: "Who's answering your phone when you're on a job?",
  d1c: 'Searched "[trade] [City]" — here\'s what I found',
  d2:  'Closing the loop — [Business Name]',
};
const INITIAL_SUBJECTS = {
  0: "Your reviews are good. Your website isn't.",
  1: "You're losing jobs after hours",
  2: 'Who shows up when someone searches for [trade] in [City]',
  3: 'What not having a website actually costs [Business Name]',
  4: 'Quick question about [Business Name]',
  5: 'When a lead texts you at 11pm — who replies?',
  6: 'Your [X] Google reviews are almost working for you',
};

/** Returns the title of the most recently sent email step. */
function lastSendLabel(brief, sent) {
  for (const step of ['d2', 'd1c', 'd1b', 'd1']) {
    if (sent?.drip?.[step]?.email_sent_at) return DRIP_LABELS[step] || step;
  }
  if (sent?.email_sent_at) {
    const tid = brief?.template_id ?? brief?.template ?? null;
    return (tid !== null && INITIAL_SUBJECTS[Number(tid)]) ? INITIAL_SUBJECTS[Number(tid)] : 'Initial email';
  }
  return '';
}

// ── Row builder ───────────────────────────────────────────────────────────────
/**
 * Build the 16-value row. existingRow is the current sheet row (array) or null.
 * statusCol / notesCol are the 0-based column indices in the existing sheet schema.
 */
function buildRow(entry, brief, sent, existingRow, statusCol, notesCol) {
  const today = new Date().toISOString().split('T')[0];

  // Preserve user-editable values (look up by actual column position in existing row)
  const existingStatus = (existingRow && statusCol >= 0) ? (existingRow[statusCol] || '') : '';
  const existingNotes  = (existingRow && notesCol  >= 0) ? (existingRow[notesCol]  || '') : '';

  // Auto-derive status for NEW rows only; existing rows keep whatever Dave set
  const isUnsub   = entry.status === 'unsubscribed' || sent?.status === 'unsubscribed';
  const isReplied = entry.status === 'replied'       || sent?.status === 'positive';
  let autoStatus = 'sent';
  if (isUnsub)        autoStatus = 'do not contact';
  else if (isReplied) autoStatus = 'replied';
  const status = existingStatus || autoStatus;

  const isoToDate = iso => (iso || '').split('T')[0];

  return [
    brief.business_name || entry.lead_id,        // A  company
    brief.email || '',                            // B  email
    brief.trade || '',                            // C  trade
    lastSendLabel(brief, sent),                   // D  last send
    today,                                        // E  date updated
    status,                                       // F  status (user-editable)
    brief.demo_url || '',                         // G  demo URL
    isoToDate(sent?.email_sent_at || entry.sent_at || ''), // H  email 1 sent
    isoToDate(sent?.drip?.d1?.email_sent_at  || ''),       // I  email 2 sent
    isoToDate(sent?.drip?.d1b?.email_sent_at || ''),       // J  email 3 sent
    isoToDate(sent?.drip?.d1c?.email_sent_at || ''),       // K  email 4 sent
    isoToDate(sent?.replied_at || entry.reply_received_at || ''), // L  last reply date
    (isReplied || isUnsub) ? (sent?.reply_subject || '') : '',    // M  reply summary
    isUnsub ? 'TRUE' : 'FALSE',                              // N  unsubscribed
    isUnsub ? isoToDate(sent?.replied_at || entry.reply_received_at || '') : '', // O  unsubscribe date
    existingNotes,                                // P  notes (user-editable)
  ];
}

/** Returns a diff string for the ChangeLog, or '' if nothing meaningful changed. */
function detectChanges(oldRow, newRow, oldEmailCol) {
  if (!oldRow) return 'new row';

  // Pad oldRow to at least newRow length for safe indexing
  const old = Array.from({ length: Math.max(oldRow.length, newRow.length) }, (_, i) => oldRow[i] || '');

  const watchCols = {
    [COL['last send']]:       'last send',
    [COL['email 2 sent']]:   'email 2',
    [COL['email 3 sent']]:   'email 3',
    [COL['email 4 sent']]:   'email 4',
    [COL['last reply date']]: 'reply',
    [COL['unsubscribed']]:   'unsubscribed',
  };

  const changes = [];
  for (const [colStr, label] of Object.entries(watchCols)) {
    const col = Number(colStr);
    const was = old[col].trim();
    const now = (newRow[col] || '').trim();
    if (now && now !== was) changes.push(`${label}: ${was || '—'} → ${now}`);
  }
  return changes.join('; ');
}

// ── helpers ───────────────────────────────────────────────────────────────────
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function wasEmailSent(leadId, brief) {
  const sent = readJsonSafe(path.join(MESSAGES_DIR, `${leadId}-sent.json`));
  if (sent && typeof sent.email_sent === 'boolean') return sent.email_sent === true;
  if (brief?.email && (brief.channel === 'email' || brief.secondary_channel === 'email')) return true;
  return false;
}

// ── Google service-account auth (hand-rolled JWT; zero extra deps) ─────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  const credPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set in .env.local (see CHECKPOINT.md).');
  if (!fs.existsSync(credPath)) throw new Error(`Service-account key not found: ${credPath}`);
  const sa = readJsonSafe(credPath);
  if (!sa?.client_email || !sa?.private_key) throw new Error('Service-account key missing client_email/private_key.');
  return sa;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const si = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(si); signer.end();
  const assertion = `${si}.${b64url(signer.sign(sa.private_key))}`;
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

async function sheetsGetAll(token, sheetId, tab) {
  const range = `${quoteTab(tab)}!A1:ZZ`;
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets read failed (HTTP ${res.status}): ${await res.text()}`);
  return (await res.json()).values || [];
}

async function sheetsBatchUpdate(token, sheetId, data) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!res.ok) throw new Error(`Sheets batchUpdate failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

async function sheetsAppend(token, sheetId, tab, rows) {
  const range = `${quoteTab(tab)}!A1`;
  const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append to "${tab}" failed (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

async function listTabs(token, sheetId) {
  const res = await fetch(`${SHEETS_BASE}/${sheetId}?fields=sheets.properties.title`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read spreadsheet tabs (HTTP ${res.status}): ${await res.text()}`);
  const json = await res.json();
  return (json.sheets || []).map(s => s.properties?.title).filter(Boolean);
}

async function ensureTab(token, sheetId, tabName) {
  const tabs = await listTabs(token, sheetId);
  if (tabs.includes(tabName)) return false;
  const res = await fetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
  });
  if (!res.ok) throw new Error(`Could not create tab "${tabName}" (HTTP ${res.status}): ${await res.text()}`);
  return true;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\nSheet-Log v3' + (DRY_RUN ? '  [DRY RUN — nothing written]' : ''));
  console.log('─'.repeat(60));

  const state = readJsonSafe(STATE_PATH);
  if (!state || !Array.isArray(state.queue)) {
    console.error('Could not read state.json queue.'); process.exit(1);
  }

  // Collect every lead ever sent via email (regardless of current status)
  const pending = [];
  let skipped = 0;
  for (const entry of state.queue) {
    // Include if it was sent at some point (sent_at set) or status was 'sent'
    if (!entry.sent_at && !['sent', 'replied', 'unsubscribed', 'drip_d1_sent',
        'drip_d1b_sent', 'drip_d1c_sent', 'drip_d2_sent', 'unresponsive'].includes(entry.status)) {
      skipped++; continue;
    }
    const brief = readJsonSafe(path.join(QUEUE_DIR, `${entry.lead_id}-brief.json`));
    if (!brief) { skipped++; continue; }
    if (!wasEmailSent(entry.lead_id, brief)) { skipped++; continue; }
    const sent = readJsonSafe(path.join(MESSAGES_DIR, `${entry.lead_id}-sent.json`));
    pending.push({ entry, brief, sent });
  }

  console.log(`email leads to sync:  ${pending.length}  (skipped: ${skipped})`);

  if (pending.length === 0) {
    console.log('\nNothing to sync. Done.');
    return;
  }

  if (DRY_RUN) {
    console.log('\nRows that WOULD be synced:');
    console.log('  ' + HEADER.join(' | '));
    for (const { entry, brief, sent } of pending) {
      const row = buildRow(entry, brief, sent, null, -1, -1);
      console.log('  ' + row.map(c => String(c || '—').slice(0, 18)).join(' | '));
    }
    console.log(`\n[dry-run] ${pending.length} lead(s) not written.`);
    return;
  }

  const sheetId = process.env.SHEET_ID;
  if (!sheetId) { console.error('SHEET_ID not set in .env.local.'); process.exit(1); }

  let token;
  try {
    const sa = loadServiceAccount();
    token = await getAccessToken(sa);
  } catch (e) {
    console.error('\n✖ Google auth failed: ' + e.message);
    console.error('  Fix: confirm GOOGLE_SERVICE_ACCOUNT_JSON in .env.local points to a valid key file.');
    process.exit(1);
  }

  // Ensure both tabs exist (leaves other tabs untouched)
  const sentLogCreated   = await ensureTab(token, sheetId, TAB);
  const changeLogCreated = await ensureTab(token, sheetId, CHANGELOG_TAB);
  if (sentLogCreated)   console.log(`Created tab "${TAB}".`);
  if (changeLogCreated) console.log(`Created tab "${CHANGELOG_TAB}".`);

  // Read existing SentLog content
  const existing   = await sheetsGetAll(token, sheetId, TAB);
  const headerRow  = existing[0] || [];
  const hasHeader  = headerRow.length > 0;

  // Locate key columns in whatever schema the existing sheet has (handles migration)
  const existingEmailCol  = hasHeader ? headerRow.indexOf('email')  : -1;
  const existingStatusCol = hasHeader ? headerRow.indexOf('status') : -1;
  const existingNotesCol  = hasHeader ? headerRow.indexOf('notes')  : -1;

  // Build email → array-index map (existing[0] = header, existing[1] = row 2, etc.)
  const emailToIdx = {};
  if (existingEmailCol >= 0) {
    for (let i = 1; i < existing.length; i++) {
      const em = (existing[i][existingEmailCol] || '').trim().toLowerCase();
      if (em) emailToIdx[em] = i;
    }
  }

  const nowIso = new Date().toISOString();

  // Classify: new rows to append, existing rows to update
  const newRows    = [];
  const updateData = [];
  const changeLog  = [];

  for (const { entry, brief, sent } of pending) {
    const emailKey   = (brief.email || '').trim().toLowerCase();
    const existingIdx = emailKey ? emailToIdx[emailKey] : undefined;
    const existingRow = existingIdx !== undefined ? existing[existingIdx] : null;

    const newRow = buildRow(entry, brief, sent, existingRow, existingStatusCol, existingNotesCol);
    const change = detectChanges(existingRow, newRow, existingEmailCol);

    if (existingIdx !== undefined) {
      if (!change) continue; // nothing meaningful changed — skip silently
      const sheetRowNum = existingIdx + 1; // existing[i] corresponds to sheet row i+1
      updateData.push({
        range:  `${quoteTab(TAB)}!A${sheetRowNum}:P${sheetRowNum}`,
        values: [newRow],
      });
      changeLog.push([nowIso, 'updated', newRow[COL['company']], newRow[COL['email']], change]);
    } else {
      newRows.push(newRow);
      changeLog.push([nowIso, 'new row', newRow[COL['company']], newRow[COL['email']], 'added to sheet']);
    }
  }

  // Write SentLog header if tab is empty
  if (!hasHeader) {
    await sheetsAppend(token, sheetId, TAB, [HEADER]);
    console.log('Wrote SentLog header row (sheet was empty).');
  }

  // Ensure ChangeLog has a header row
  const changeLogRows = await sheetsGetAll(token, sheetId, CHANGELOG_TAB);
  const changeLogHasHeader = changeLogRows.length > 0 && changeLogRows[0].length > 0;
  if (!changeLogHasHeader) {
    await sheetsAppend(token, sheetId, CHANGELOG_TAB, [CHANGELOG_HEADER]);
    console.log('Wrote ChangeLog header row.');
  }

  // Apply in-place updates (batchUpdate)
  if (updateData.length > 0) {
    await sheetsBatchUpdate(token, sheetId, updateData);
  }

  // Append new rows to SentLog
  if (newRows.length > 0) {
    await sheetsAppend(token, sheetId, TAB, newRows);
  }

  // Append ChangeLog entries
  if (changeLog.length > 0) {
    await sheetsAppend(token, sheetId, CHANGELOG_TAB, changeLog);
  }

  console.log('─'.repeat(60));
  console.log('Summary');
  console.log(`  new rows appended:    ${newRows.length}`);
  console.log(`  rows updated:         ${updateData.length}`);
  console.log(`  changelog entries:    ${changeLog.length}`);
  console.log(`  leads skipped:        ${skipped}`);
  console.log('\nDone. Edit columns F (status) and P (notes) in the Sheet by hand.');
  console.log('      ChangeLog tab records every create and meaningful change.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
