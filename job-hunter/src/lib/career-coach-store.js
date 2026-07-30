// career-coach-store.js — the human approval gate for career-coach resume drafts.
//
// Mirrors Trevo's scripts/lib/lead-batches.js pattern (same repo, sibling
// system): a flat JSON store keyed by job id, a STATUS enum, and refuse-once-
// actioned semantics. Small and human-readable — safe to hand-edit if an
// approval needs undoing.
//
// Nothing here writes a .docx. A draft only becomes a real resume/cover-letter
// file when scripts/approve-tailor.js explicitly approves it.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const STORE_PATH = path.join(config.paths.data, 'career-coach-drafts.json');

export const STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' };

export function loadStore(storePath = STORE_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (!raw.drafts || typeof raw.drafts !== 'object') raw.drafts = {};
    return raw;
  } catch {
    return { drafts: {} };
  }
}

export function saveStore(store, storePath = STORE_PATH) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n');
}

/**
 * Record a freshly drafted career-coach review as pending approval. Idempotent
 * per job id: re-running the same job updates the draft rather than creating a
 * duplicate, but never resurrects a draft Dave already approved or rejected.
 */
export function createDraft(id, draft, { store = loadStore(), storePath = STORE_PATH, persist = true } = {}) {
  const existing = store.drafts[id];
  if (existing && existing.status !== STATUS.PENDING) {
    return { created: false, reason: `draft ${id} is already ${existing.status}`, draft: existing };
  }
  const record = {
    id,
    status: STATUS.PENDING,
    createdAt: new Date().toISOString(),
    approvedAt: null,
    rejectedAt: null,
    ...draft,
  };
  store.drafts[id] = record;
  if (persist) saveStore(store, storePath);
  return { created: true, draft: record };
}

export function setStatus(id, status, { store = loadStore(), storePath = STORE_PATH, persist = true } = {}) {
  const draft = store.drafts[id];
  if (!draft) return { ok: false, reason: `no draft for ${id}` };
  if (draft.status !== STATUS.PENDING) {
    return { ok: false, reason: `draft ${id} was already ${draft.status}`, draft };
  }
  draft.status = status;
  if (status === STATUS.APPROVED) draft.approvedAt = new Date().toISOString();
  if (status === STATUS.REJECTED) draft.rejectedAt = new Date().toISOString();
  if (persist) saveStore(store, storePath);
  return { ok: true, draft };
}

export const approveDraft = (id, opts) => setStatus(id, STATUS.APPROVED, opts);
export const rejectDraft = (id, opts) => setStatus(id, STATUS.REJECTED, opts);

export function getDraft(id, { store = loadStore() } = {}) {
  return store.drafts[id] || null;
}

export function pendingDrafts({ store = loadStore() } = {}) {
  return Object.values(store.drafts)
    .filter((d) => d.status === STATUS.PENDING)
    .sort((a, b) => b.fitPercent - a.fitPercent);
}
