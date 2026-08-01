'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFeedback, recordFeedback, computeAccuracy, isValidVerdict } = require('../lib/feedback');
const { buildRanking } = require('../lib/ranking');

// In-memory store so no test ever touches merlin/feedback.json.
function store(initial = []) {
  let raw = JSON.stringify({ entries: initial });
  return {
    read: () => raw,
    write: (s) => { raw = s; },
    entries: () => JSON.parse(raw).entries,
  };
}

test('recordFeedback — appends, never rewrites, and stamps the record', () => {
  const s = store();
  recordFeedback({ id: 'a', verdict: 'already-done', note: 'shipped in 6db94f9' },
    { read: s.read, write: s.write, now: () => '2026-07-31T00:00:00.000Z' });
  recordFeedback({ id: 'b', verdict: 'good' },
    { read: s.read, write: s.write, now: () => '2026-08-01T00:00:00.000Z' });

  const entries = s.entries();
  assert.equal(entries.length, 2, 'second entry appended rather than replacing the first');
  assert.equal(entries[0].id, 'a');
  assert.equal(entries[0].note, 'shipped in 6db94f9');
  assert.equal(entries[0].recordedAt, '2026-07-31T00:00:00.000Z');
});

test('recordFeedback — rejects an unknown verdict and a missing id', () => {
  const s = store();
  assert.throws(() => recordFeedback({ id: 'a', verdict: 'nope' }, { read: s.read, write: s.write }), /unknown verdict/);
  assert.throws(() => recordFeedback({ verdict: 'good' }, { read: s.read, write: s.write }), /needs a candidate id/);
  assert.equal(s.entries().length, 0, 'nothing written on a rejected call');
});

test('loadFeedback — suppressing verdicts suppress, good does not', () => {
  const s = store([
    { id: 'stale', verdict: 'already-done', recordedAt: '2026-07-31T00:00:00.000Z' },
    { id: 'fine', verdict: 'good', recordedAt: '2026-07-31T00:00:00.000Z' },
  ]);
  const fb = loadFeedback(s.read);
  assert.equal(fb.isSuppressed('stale'), true);
  assert.equal(fb.isSuppressed('fine'), false, 'confirming a good recommendation must not hide it');
  assert.equal(fb.feedbackFor('stale').verdict, 'already-done');
});

test('loadFeedback — a later reinstate overrides an earlier suppression without deleting history', () => {
  const s = store([
    { id: 'x', verdict: 'wrong-premise', recordedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'x', verdict: 'reinstate', note: 'situation changed', recordedAt: '2026-08-01T00:00:00.000Z' },
  ]);
  const fb = loadFeedback(s.read);
  assert.equal(fb.isSuppressed('x'), false, 'last entry per id wins');
  assert.equal(fb.entries.length, 2, 'both entries survive — the log is append-only');
});

test('loadFeedback — malformed or unparseable input degrades to empty, never throws', () => {
  assert.equal(loadFeedback(() => 'not json').entries.length, 0);
  assert.equal(loadFeedback(() => JSON.stringify({ entries: 'wrong type' })).entries.length, 0);
  const skipsBadRows = loadFeedback(() => JSON.stringify({
    entries: [{ id: 'ok', verdict: 'good' }, { verdict: 'good' }, { id: 'x', verdict: 'bogus' }],
  }));
  assert.equal(skipsBadRows.latestById.size, 1, 'rows missing an id or carrying an unknown verdict are ignored');
});

test('computeAccuracy — counts every entry, not just the latest per id', () => {
  // Merlin recommending the same stale item three nights running is three
  // misses; collapsing them would hide the repetition this is meant to catch.
  const a = computeAccuracy([
    { id: 'x', verdict: 'already-done' },
    { id: 'x', verdict: 'already-done' },
    { id: 'x', verdict: 'already-done' },
    { id: 'y', verdict: 'good' },
    { id: 'z', verdict: 'reinstate' },
  ]);
  assert.equal(a.off, 3);
  assert.equal(a.good, 1);
  assert.equal(a.rated, 4, 'reinstate is bookkeeping, not a score');
  assert.equal(a.accuracyPct, 25);
  assert.equal(a.offByReason['already-done'], 3);
});

test('computeAccuracy — no rated feedback yields null, not a misleading 0%', () => {
  assert.equal(computeAccuracy([]).accuracyPct, null);
  assert.equal(computeAccuracy([{ id: 'x', verdict: 'reinstate' }]).accuracyPct, null);
});

test('buildRanking — a suppressed candidate is dropped into corrected, with its feedback attached', () => {
  const fb = loadFeedback(() => JSON.stringify({
    entries: [{ id: 'add_stripe_key', verdict: 'already-done', note: 'live since 6db94f9', recordedAt: '2026-07-31T00:00:00.000Z' }],
  }));
  const ranking = buildRanking({ pipelineSnapshot: { integrityFlags: [] }, feedback: fb });

  assert.equal(ranking.ranked.some(c => c.id === 'add_stripe_key'), false, 'not recommended any more');
  const corrected = ranking.corrected.find(c => c.id === 'add_stripe_key');
  assert.ok(corrected, 'it lands in corrected rather than vanishing silently');
  assert.equal(corrected.feedback.note, 'live since 6db94f9', 'the report can explain why it was dropped');
});

test('isValidVerdict — guards the CLI surface', () => {
  assert.equal(isValidVerdict('already-done'), true);
  assert.equal(isValidVerdict('good'), true);
  assert.equal(isValidVerdict('lgtm'), false);
});
