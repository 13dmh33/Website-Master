'use strict';
/**
 * Global do-not-contact store — keyed on the CONTACT (email / phone / domain),
 * not on lead_id. This is what makes an opt-out survive across campaigns: if
 * the same business is re-scraped under a new Google place_id or re-imported
 * with a fresh id, lead_id-keyed suppression (state.json status, lib/suppression.js)
 * misses it — but the email/phone/domain still match here, so it stays out.
 *
 * Two enforcement points:
 *   - ingestion (sheet-import / scout): reject a suppressed contact before it
 *     ever enters the pipeline.
 *   - every send lane (pitcher / drip): final gate before a message goes out.
 *
 * The canonical opt-out signal is still state.json status === 'unsubscribed'
 * (written by webhook.js / poller.js / reply-agent.js). syncFromState() walks
 * those and backfills this store from each lead's brief, so the store is
 * self-healing even if an opt-out writer forgets to call addContact directly.
 *
 * Pure logic with injectable I/O at the edges for testing.
 */

const fs = require('fs');
const path = require('path');
const { normalizeDomain } = require('./scout-shared');

const ROOT = path.join(__dirname, '..', '..');
const STORE_PATH = path.join(ROOT, 'config', 'do-not-contact.json');
const STATE_PATH = path.join(ROOT, 'state.json');
const QUEUE_DIR = path.join(ROOT, 'queue');

// ── NORMALIZERS ──────────────────────────────────────────────────────────────

function normEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e && e.includes('@') ? e : null;
}

/** US phone → last 10 digits, so "+1 702-480-9195", "(702) 480-9195", "7024809195" all match. */
function normPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function normDomain(websiteOrDomain) {
  if (!websiteOrDomain) return null;
  return normalizeDomain(websiteOrDomain);
}

/** The set of normalized identifiers for a contact — however many it has. */
function identifiersOf(contact = {}) {
  return {
    email: normEmail(contact.email),
    phone: normPhone(contact.phone),
    domain: normDomain(contact.website || contact.domain),
  };
}

// ── STORE I/O ──────────────────────────────────────────────────────────────

function loadStore(read = () => fs.readFileSync(STORE_PATH, 'utf8')) {
  try {
    const raw = JSON.parse(read());
    if (!Array.isArray(raw.entries)) raw.entries = [];
    return raw;
  } catch {
    return { entries: [] };
  }
}

function saveStore(store, write = (s) => fs.writeFileSync(STORE_PATH, s)) {
  write(JSON.stringify(store, null, 2));
}

// ── LOOKUP ──────────────────────────────────────────────────────────────

/** True if any of the contact's identifiers matches any stored entry. */
function isContactSuppressed(contact, store = loadStore()) {
  const id = identifiersOf(contact);
  if (!id.email && !id.phone && !id.domain) return false;
  for (const e of store.entries) {
    if (id.email && e.email && id.email === e.email) return true;
    if (id.phone && e.phone && id.phone === e.phone) return true;
    if (id.domain && e.domain && id.domain === e.domain) return true;
  }
  return false;
}

// ── WRITE ──────────────────────────────────────────────────────────────

/**
 * Add/merge a contact into the store. Idempotent: if an existing entry shares
 * any identifier, it's merged (fills missing identifiers, keeps the earliest
 * timestamp, and an 'opted_out' reason outranks a softer one). Returns
 * { store, added: bool }.
 */
function addContact(contact, store = loadStore()) {
  const id = identifiersOf(contact);
  if (!id.email && !id.phone && !id.domain) return { store, added: false }; // nothing to key on

  const match = store.entries.find(e =>
    (id.email && e.email === id.email) ||
    (id.phone && e.phone === id.phone) ||
    (id.domain && e.domain === id.domain));

  const reason = contact.reason || 'opted_out';
  if (match) {
    match.email = match.email || id.email;
    match.phone = match.phone || id.phone;
    match.domain = match.domain || id.domain;
    if (reason === 'opted_out') match.reason = 'opted_out';
    match.business_name = match.business_name || contact.business_name || null;
    return { store, added: false };
  }

  store.entries.push({
    email: id.email,
    phone: id.phone,
    domain: id.domain,
    reason,
    business_name: contact.business_name || null,
    lead_id: contact.lead_id || null,
    at: contact.at || new Date().toISOString(),
  });
  return { store, added: true };
}

// ── SELF-HEALING SYNC ──────────────────────────────────────────────────────

/**
 * Backfill the store from every unsubscribed lead in state.json, reading each
 * lead's brief for its email/phone/website. Idempotent — safe to run before
 * every ingestion/send. Returns { added, scanned }.
 */
function syncFromState({ statePath = STATE_PATH, queueDir = QUEUE_DIR, store = loadStore(), persist = true } = {}) {
  let scanned = 0, added = 0;
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { added, scanned, store }; }
  for (const lead of (state.queue || [])) {
    if (lead.status !== 'unsubscribed') continue;
    scanned++;
    let brief = {};
    try { brief = JSON.parse(fs.readFileSync(path.join(queueDir, `${lead.lead_id}-brief.json`), 'utf8')); } catch { /* no brief — may still have nothing to key on */ }
    const res = addContact({
      email: brief.email, phone: brief.phone, website: brief.website,
      business_name: brief.business_name, lead_id: lead.lead_id, reason: 'opted_out',
    }, store);
    if (res.added) added++;
  }
  if (persist && added > 0) saveStore(store);
  return { added, scanned, store };
}

module.exports = {
  normEmail, normPhone, normDomain, identifiersOf,
  loadStore, saveStore, isContactSuppressed, addContact, syncFromState,
  STORE_PATH,
};
