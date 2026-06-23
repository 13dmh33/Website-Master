/**
 * sheets-client.js — thin wrapper around the Google Sheets API.
 *
 * Mirrors pipeline state into a Google Sheet for human visibility:
 *   - appendLeads(leads)       called by Scout after a new leads/*.json is written
 *   - upsertStatus(lead_id, fields)  called by Diagnoser/Pitcher/Drip/Mobile on every
 *                                    state.json status transition
 *
 * state.json (and the leads/queue/messages JSON files) remain the source of truth.
 * The Sheet is a read-only mirror for the human — nothing reads back from it.
 *
 * Requires GOOGLE_SHEET_ID + GOOGLE_SHEETS_KEY_PATH in .env.local. If either is
 * missing, every function here becomes a silent no-op so the rest of the
 * pipeline keeps working without Sheets configured.
 */

const fs = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const SHEET_ID       = process.env.GOOGLE_SHEET_ID;
const KEY_PATH       = process.env.GOOGLE_SHEETS_KEY_PATH
  ? path.resolve(ROOT, process.env.GOOGLE_SHEETS_KEY_PATH)
  : null;
const TAB            = process.env.GOOGLE_SHEETS_TAB || 'Leads';

const LEAD_COLUMNS = [
  'lead_id', 'business_name', 'trade', 'city', 'phone', 'email',
  'review_count', 'rating', 'gap_score', 'channel', 'address',
  'status', 'scraped_at', 'updated_at'
];

let sheetsApiPromise = null;

function enabled() {
  return Boolean(SHEET_ID && KEY_PATH && fs.existsSync(KEY_PATH));
}

async function getSheetsApi() {
  if (!enabled()) return null;
  if (!sheetsApiPromise) {
    sheetsApiPromise = (async () => {
      const { google } = require('googleapis');
      const auth = new google.auth.GoogleAuth({
        keyFile: KEY_PATH,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      return google.sheets({ version: 'v4', auth });
    })();
  }
  return sheetsApiPromise;
}

// Reads column A (lead_id) of the tab to build a lead_id -> row_number index.
// Row 1 is the header, so data starts at row 2.
async function getRowIndex(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A2:A`
  });
  const rows = res.data.values || [];
  const index = new Map();
  rows.forEach((row, i) => {
    if (row[0]) index.set(row[0], i + 2); // +2: skip header, 0-indexed -> 1-indexed
  });
  return index;
}

async function ensureHeader(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A1:A1`
  });
  if (res.data.values && res.data.values.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [LEAD_COLUMNS] }
  });
}

function rowFor(lead) {
  return LEAD_COLUMNS.map(col => {
    const v = lead[col];
    return v === undefined || v === null ? '' : v;
  });
}

/**
 * Appends one row per lead that isn't already in the sheet (deduped by lead_id).
 * Call after writing leads/*.json — pass the same lead objects, each lead can
 * optionally include status (defaults to 'scouted').
 */
async function appendLeads(leads) {
  if (!leads || leads.length === 0) return;
  const sheets = await getSheetsApi();
  if (!sheets) {
    console.warn('  [sheets] GOOGLE_SHEET_ID/GOOGLE_SHEETS_KEY_PATH not configured — skipping sheet sync');
    return;
  }
  try {
    await ensureHeader(sheets);
    const index = await getRowIndex(sheets);
    const now = new Date().toISOString();
    const newRows = leads
      .filter(l => l.lead_id && !index.has(l.lead_id))
      .map(l => rowFor({ ...l, status: l.status || 'scouted', updated_at: now }));

    if (newRows.length === 0) return;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newRows }
    });
    console.log(`  [sheets] appended ${newRows.length} lead(s) to "${TAB}"`);
  } catch (e) {
    console.warn(`  [sheets] appendLeads failed: ${e.message}`);
  }
}

/**
 * Updates the status (and any other known columns) for an existing lead row,
 * keyed by lead_id. No-ops if the lead isn't found — it should have been
 * appended by Scout first.
 */
async function upsertStatus(leadId, fields = {}) {
  if (!leadId) return;
  const sheets = await getSheetsApi();
  if (!sheets) return; // silent — Sheets not configured, don't spam logs on every status change

  try {
    const index = await getRowIndex(sheets);
    const row = index.get(leadId);
    if (!row) {
      console.warn(`  [sheets] upsertStatus: lead_id "${leadId}" not found in "${TAB}" — skipping`);
      return;
    }

    const updates = { ...fields, updated_at: new Date().toISOString() };
    const data = Object.entries(updates)
      .filter(([col]) => LEAD_COLUMNS.includes(col))
      .map(([col, value]) => {
        const colLetter = String.fromCharCode(65 + LEAD_COLUMNS.indexOf(col)); // A, B, C...
        return { range: `${TAB}!${colLetter}${row}`, values: [[value]] };
      });

    if (data.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: 'RAW', data }
    });
  } catch (e) {
    console.warn(`  [sheets] upsertStatus failed for ${leadId}: ${e.message}`);
  }
}

module.exports = { enabled, appendLeads, upsertStatus };
