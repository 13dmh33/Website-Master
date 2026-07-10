'use strict';
/**
 * google-sheets — shared Google Sheets v4 client (service-account JWT auth).
 *
 * Hand-rolled JWT signing (zero extra deps beyond Node's crypto/fetch), factored
 * out of scripts/sheet-log.js so other tools (e.g. scripts/contact-scraper.js
 * --deep) can push rows to the same CRM without duplicating auth logic.
 *
 * Behaviour is identical to the code that previously lived inline in sheet-log.js
 * — same endpoints, same JWT claims, same error messages — so nothing about the
 * existing Sheet-Log flow changes.
 *
 * Env: GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS) → path to
 *      a Google service-account key JSON with { client_email, private_key }.
 */

const fs     = require('fs');
const crypto = require('crypto');

const DEFAULT_SHEET_ID = '1MNTg-WIT-NwwtOnP4QDs9M5QuG8UcDnmX8Jj8SxtTc8';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';
const SCOPE       = 'https://www.googleapis.com/auth/spreadsheets';

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function quoteTab(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

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

module.exports = {
  DEFAULT_SHEET_ID, SHEETS_BASE, TOKEN_URL, SCOPE,
  quoteTab, b64url, loadServiceAccount, getAccessToken,
  sheetsGetAll, sheetsBatchUpdate, sheetsAppend, listTabs, ensureTab,
};
