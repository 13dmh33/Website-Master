// state.js — the append-only dedup ledger (state.json).
//
// Invariant from the spec: state.json is APPEND-ONLY. We add new job ids and
// new digest records; we never mutate an existing job's fields. In particular
// `firstSeenAt` is written exactly once (the first run that ever saw the job)
// and is then frozen, because recency ranking depends on it being stable.
//
// Shape:
// {
//   "seen":      { "<jobId>": { "firstSeenAt": ISO, "source", "company", "title" } },
//   "digests":   [ { "date": ISO, "jobIds": [...] } ],
//   "instant":   { "<jobId>": ISO }   // one-off high-fit alerts already fired
//   "scores":    { "<jobId>": { "fingerprint", "fit", "rationale", "keywords", "scoredAt" } }
// }

import fs from 'node:fs';
import { config } from './config.js';

const EMPTY = { seen: {}, digests: [], instant: {}, scores: {} };

export function loadState() {
  try {
    const raw = fs.readFileSync(config.paths.state, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      seen: parsed.seen || {},
      digests: parsed.digests || [],
      instant: parsed.instant || {},
      scores: parsed.scores || {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state) {
  fs.writeFileSync(config.paths.state, JSON.stringify(state, null, 2));
}

export function isSeen(state, jobId) {
  return Boolean(state.seen[jobId]);
}

// Record a job as seen. Returns its firstSeenAt (existing if known, else `now`).
// NEVER overwrites an existing record — append-only.
export function markSeen(state, job, nowIso) {
  const existing = state.seen[job.id];
  if (existing && existing.firstSeenAt) return existing.firstSeenAt;
  const firstSeenAt = nowIso || new Date().toISOString();
  state.seen[job.id] = {
    firstSeenAt,
    source: job.source,
    company: job.company,
    title: job.title,
  };
  return firstSeenAt;
}

export function recordDigest(state, jobIds, nowIso) {
  state.digests.push({ date: nowIso || new Date().toISOString(), jobIds });
}

export function hasSentInstant(state, jobId) {
  return Boolean(state.instant[jobId]);
}

export function markInstant(state, jobId, nowIso) {
  state.instant[jobId] = nowIso || new Date().toISOString();
}

// Cached Haiku score for a job, keyed by job id + a fingerprint of the profile
// and preferences that produced it. A stored score is only reused while the
// fingerprint still matches — if the resume or preferences.md changes, the
// fingerprint changes, the cache is treated as a miss, and the entry is
// overwritten with a freshly-scored result (the one exception to append-only:
// a stale score is wrong, not historical, so it gets corrected rather than kept).
export function getCachedScore(state, jobId, fingerprint) {
  const entry = state.scores[jobId];
  if (!entry || entry.fingerprint !== fingerprint) return null;
  return entry;
}

export function cacheScore(state, jobId, fingerprint, { fit, rationale, keywords }) {
  state.scores[jobId] = { fingerprint, fit, rationale, keywords, scoredAt: new Date().toISOString() };
}
