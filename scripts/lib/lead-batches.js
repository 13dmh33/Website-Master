'use strict';
/**
 * Daily lead batches — the human approval gate between scraping and sending.
 *
 * Per Dave's 2026-07-28 decision, the pipeline is deliberately one day
 * out of phase:
 *
 *   Day N, 06:30   scrape a new market -> write batch N as "pending"
 *                  -> email Dave the companies + contacts
 *   Day N, daytime Dave reviews and approves (or rejects) batch N
 *   Day N+1, 06:30 send batch N (approved only), then scrape batch N+1
 *
 * Nothing is ever sent the same morning it was scraped, and nothing is sent
 * without an explicit approval recorded here. A batch left un-approved simply
 * never sends — the safe default is silence, not delivery.
 *
 * Store: config/lead-batches.json. Small, human-readable, and safe to hand-edit
 * if an approval needs undoing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STORE_PATH = path.join(ROOT, 'config', 'lead-batches.json');

const STATUS = { PENDING: 'pending', APPROVED: 'approved', SENT: 'sent', REJECTED: 'rejected' };

function loadStore(storePath = STORE_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!raw.batches || typeof raw.batches !== 'object') raw.batches = {};
    return raw;
  } catch {
    return { batches: {} };
  }
}

function saveStore(store, storePath = STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n');
}

/**
 * Record a freshly scraped batch as pending approval. Idempotent per date:
 * re-running the same day updates the lead list rather than creating a
 * duplicate, but never resurrects a batch Dave already approved or rejected.
 */
function createBatch(date, leads, { store = loadStore(), storePath = STORE_PATH, persist = true } = {}) {
  const existing = store.batches[date];
  if (existing && existing.status !== STATUS.PENDING) {
    return { created: false, reason: `batch ${date} is already ${existing.status}`, batch: existing };
  }
  const batch = {
    date,
    status: STATUS.PENDING,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    sentAt: null,
    leads: leads.map(l => ({
      lead_id: l.lead_id,
      business_name: l.business_name || '',
      email: l.email || '',
      city: l.city || '',
      trade: l.trade || '',
    })),
  };
  store.batches[date] = batch;
  if (persist) saveStore(store, storePath);
  return { created: true, batch };
}

function setStatus(date, status, { store = loadStore(), storePath = STORE_PATH, persist = true } = {}) {
  const batch = store.batches[date];
  if (!batch) return { ok: false, reason: `no batch for ${date}` };
  if (batch.status === STATUS.SENT) return { ok: false, reason: `batch ${date} was already sent`, batch };

  batch.status = status;
  if (status === STATUS.APPROVED) batch.approvedAt = new Date().toISOString();
  if (status === STATUS.SENT) batch.sentAt = new Date().toISOString();
  if (persist) saveStore(store, storePath);
  return { ok: true, batch };
}

const approveBatch = (date, opts) => setStatus(date, STATUS.APPROVED, opts);
const rejectBatch  = (date, opts) => setStatus(date, STATUS.REJECTED, opts);
const markSent     = (date, opts) => setStatus(date, STATUS.SENT, opts);

function getBatch(date, { store = loadStore() } = {}) {
  return store.batches[date] || null;
}

/**
 * The batch that should go out now: the most recent APPROVED batch that has not
 * been sent. Deliberately returns approved-only — a pending batch is one Dave
 * has not looked at, and must never send by default.
 */
function nextSendableBatch({ store = loadStore() } = {}) {
  const approved = Object.values(store.batches)
    .filter(b => b.status === STATUS.APPROVED)
    .sort((a, b) => a.date.localeCompare(b.date));
  return approved[0] || null;
}

/** Lead ids approved for sending on a given date — the allowlist pitcher uses. */
function approvedLeadIds(date, { store = loadStore() } = {}) {
  const b = store.batches[date];
  if (!b || b.status !== STATUS.APPROVED) return new Set();
  return new Set(b.leads.map(l => l.lead_id));
}

function pendingBatches({ store = loadStore() } = {}) {
  return Object.values(store.batches)
    .filter(b => b.status === STATUS.PENDING)
    .sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  STATUS, STORE_PATH,
  loadStore, saveStore, createBatch,
  approveBatch, rejectBatch, markSent, setStatus,
  getBatch, nextSendableBatch, approvedLeadIds, pendingBatches,
};
