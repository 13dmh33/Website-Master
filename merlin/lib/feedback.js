'use strict';
/**
 * Session feedback — the correction channel Merlin was missing.
 *
 * Why this exists. On 2026-07-31 Merlin's top recommendation was "Add a real
 * STRIPE_SECRET_KEY and replace placeholder Payment Link URLs" and it
 * generated a five-hour session around it. The work was already done, and
 * half the task was never real (Payment Links are Stripe-hosted, so no secret
 * key is involved). A session discovered that in Phase 0 and fixed the
 * resolver by hand — but nothing recorded that Merlin had been wrong, so
 * there was no way for it to learn, and no record of how often this happens.
 *
 * Two stores already existed and neither covers this:
 *   decisions.json  — durable human policy, hand-authored with long rationale.
 *                     Right for "we decided X"; too heavyweight for "your last
 *                     report was stale about Y."
 *   repo-facts.js   — machine verification against live repo state. Right when
 *                     a predicate can be written; useless for anything with no
 *                     repo trace (vendor settings) or a premise that was just
 *                     wrong.
 *
 * Feedback is the third: cheap, append-only, recorded by whoever ran the
 * session, and it tracks Merlin's accuracy over time rather than only
 * suppressing individual items.
 *
 * Append-only on purpose — a correction is an observation about a specific
 * report on a specific date, and rewriting history would destroy the accuracy
 * record this exists to build. Reversal is a new entry (verdict 'reinstate'),
 * not a deletion.
 *
 * Pure except for file reads/writes at the edge; every I/O path is injectable.
 */

const fs = require('fs');
const path = require('path');

const FEEDBACK_PATH = path.join(__dirname, '..', 'feedback.json');

/**
 * Verdicts a session can record. Suppressing verdicts drop the candidate from
 * future ranked pools; 'good' is kept deliberately so accuracy is not measured
 * only from complaints — a scorecard built from negative reports alone would
 * make Merlin look worse the more it is used.
 */
const VERDICTS = {
  'already-done': { suppresses: true, counts: 'off', label: 'already done before the report ran' },
  'wrong-premise': { suppresses: true, counts: 'off', label: 'premise was not true' },
  'not-worth-it': { suppresses: true, counts: 'off', label: 'real, but not worth doing' },
  'good': { suppresses: false, counts: 'good', label: 'recommendation was correct and useful' },
  'reinstate': { suppresses: false, counts: null, label: 'undo a previous suppression' },
};

function isValidVerdict(v) {
  return Object.prototype.hasOwnProperty.call(VERDICTS, v);
}

function readRaw(read) {
  try {
    const parsed = JSON.parse(read());
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/**
 * loadFeedback() — resolves the append-only log into current state.
 *
 * Last entry per candidate id wins, so a later 'reinstate' (or a corrected
 * verdict) overrides an earlier suppression without mutating history.
 */
function loadFeedback(read = () => fs.readFileSync(FEEDBACK_PATH, 'utf8')) {
  const entries = readRaw(read);

  const latestById = new Map();
  for (const e of entries) {
    if (!e || !e.id || !isValidVerdict(e.verdict)) continue;
    latestById.set(e.id, e);
  }

  const suppressedIds = new Map();
  for (const [id, e] of latestById) {
    if (VERDICTS[e.verdict].suppresses) suppressedIds.set(id, e);
  }

  return {
    entries,
    latestById,
    suppressedIds,
    isSuppressed: (id) => suppressedIds.has(id),
    feedbackFor: (id) => suppressedIds.get(id) || null,
    accuracy: () => computeAccuracy(entries),
  };
}

/**
 * Accuracy over the whole log. Counts every entry, not just the latest per id:
 * if Merlin recommended the same stale item on three separate nights and a
 * session flagged it each time, that is three misses, and collapsing them to
 * one would hide exactly the repetition this is meant to surface.
 */
function computeAccuracy(entries) {
  let good = 0;
  let off = 0;
  const offByReason = {};
  for (const e of entries || []) {
    if (!e || !isValidVerdict(e.verdict)) continue;
    const counts = VERDICTS[e.verdict].counts;
    if (counts === 'good') good++;
    else if (counts === 'off') {
      off++;
      offByReason[e.verdict] = (offByReason[e.verdict] || 0) + 1;
    }
  }
  const rated = good + off;
  return {
    rated,
    good,
    off,
    offByReason,
    accuracyPct: rated > 0 ? Math.round((good / rated) * 1000) / 10 : null,
  };
}

/**
 * recordFeedback() — append one entry. Returns the written entry.
 * Injectable read/write so tests never touch the real file.
 */
function recordFeedback(entry, {
  read = () => fs.readFileSync(FEEDBACK_PATH, 'utf8'),
  write = (s) => fs.writeFileSync(FEEDBACK_PATH, s),
  now = () => new Date().toISOString(),
} = {}) {
  if (!entry || !entry.id) throw new Error('feedback needs a candidate id');
  if (!isValidVerdict(entry.verdict)) {
    throw new Error(`unknown verdict "${entry.verdict}" — expected one of: ${Object.keys(VERDICTS).join(', ')}`);
  }
  const record = {
    id: entry.id,
    verdict: entry.verdict,
    note: entry.note || '',
    reportDate: entry.reportDate || null,
    recordedAt: now(),
  };
  const entries = readRaw(read);
  entries.push(record);
  write(`${JSON.stringify({
    _comment: 'Append-only log of session feedback on Merlin recommendations. Written by merlin/feedback.js; Merlin reads it to suppress items it got wrong and to report its own accuracy. Do not hand-edit: reverse an entry by recording a "reinstate" verdict instead.',
    entries,
  }, null, 2)}\n`);
  return record;
}

module.exports = {
  loadFeedback, recordFeedback, computeAccuracy,
  VERDICTS, isValidVerdict, FEEDBACK_PATH,
};
