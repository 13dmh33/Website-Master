// sheets.js — the Google Sheet is the tracker of record AND the feedback source.
//
// Columns (fixed): date | company | title | location | score | url | status | notes
//   - `status` is Dave's manual field: new / reviewing / applied / passed / interview
//   - the scorer reads recent applied/passed/interview rows to calibrate future runs
//
// Auth is a Google service account (read+write). If the sheet is not configured
// the whole module degrades to no-ops that report `enabled: false`, so the
// pipeline still runs (it just won't log to the sheet or read feedback).

import fs from 'node:fs';
import { google } from 'googleapis';
import { config, has } from './config.js';

export const HEADER = ['date', 'company', 'title', 'location', 'score', 'url', 'status', 'notes'];
const TAB = 'Jobs';

let _sheets = null;

async function sheetsClient() {
  if (_sheets) return _sheets;
  if (!has.sheets()) return null;
  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(config.sheets.serviceAccountJson, 'utf8'));
  } catch (e) {
    throw new Error(
      `could not read GOOGLE_SERVICE_ACCOUNT_JSON at ${config.sheets.serviceAccountJson}: ${e.message}`,
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return _sheets;
}

// Make sure the tab exists and the header row is present. Idempotent.
export async function ensureSheet() {
  const svc = await sheetsClient();
  if (!svc) return { enabled: false };
  const meta = await svc.spreadsheets.get({ spreadsheetId: config.sheets.sheetId });
  const hasTab = (meta.data.sheets || []).some((s) => s.properties.title === TAB);
  if (!hasTab) {
    await svc.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }
  const first = await svc.spreadsheets.values.get({
    spreadsheetId: config.sheets.sheetId,
    range: `${TAB}!A1:H1`,
  });
  if (!first.data.values || first.data.values.length === 0) {
    await svc.spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `${TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    });
  }
  return { enabled: true };
}

// Append one row per matched job. `rows` are arrays matching HEADER order.
export async function appendRows(rows) {
  const svc = await sheetsClient();
  if (!svc) return { enabled: false, appended: 0 };
  if (!rows.length) return { enabled: true, appended: 0 };
  await svc.spreadsheets.values.append({
    spreadsheetId: config.sheets.sheetId,
    range: `${TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  return { enabled: true, appended: rows.length };
}

// Read the most recent rows Dave has marked applied/passed/interview, newest
// last in the sheet -> returned newest first. Skips cleanly if the sheet is
// empty or unconfigured.
export async function readFeedbackExamples(limit = 10) {
  const svc = await sheetsClient();
  if (!svc) return [];
  let resp;
  try {
    resp = await svc.spreadsheets.values.get({
      spreadsheetId: config.sheets.sheetId,
      range: `${TAB}!A2:H`,
    });
  } catch {
    return [];
  }
  const rows = resp.data.values || [];
  const marked = rows
    .map((r) => ({
      date: r[0] || '',
      company: r[1] || '',
      title: r[2] || '',
      location: r[3] || '',
      status: (r[6] || '').toLowerCase().trim(),
    }))
    .filter((r) => ['applied', 'passed', 'interview'].includes(r.status));
  return marked.slice(-limit).reverse();
}
