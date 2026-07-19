'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectIntegrityFlags, collectPipelineSnapshot, NORMAL_DAILY_LIMIT } = require('../lib/pipeline-snapshot');

function baseArgs(overrides = {}) {
  return {
    pitcherConfig: { daily_limit: 30 },
    checkerConfig: { daily_limit: 30 },
    diagnoserConfig: { daily_limit: 30 },
    apollo: { phoneOnly: { attempted: 5 }, hasWebsite: { attempted: 0 } },
    ...overrides,
  };
}

test('collectIntegrityFlags — closed_not_won is always present', () => {
  const flags = collectIntegrityFlags(baseArgs());
  assert.ok(flags.map(f => f.id).includes('closed_not_won'));
});

test('collectIntegrityFlags — poller gap is flagged only when poller.js lacks the reply-classifier fix (Task 10d)', () => {
  // Unfixed / unknown poller source → gap is flagged.
  const unfixed = collectIntegrityFlags(baseArgs({ pollerSrc: 'const x = 1; // no classifier wired' }));
  assert.ok(unfixed.map(f => f.id).includes('poller_email_reply_gap'));
  const unknown = collectIntegrityFlags(baseArgs({ pollerSrc: null }));
  assert.ok(unknown.map(f => f.id).includes('poller_email_reply_gap'));

  // Fixed poller source → gap must NOT be re-raised (Merlin's own repo-facts see it fixed).
  const fixed = collectIntegrityFlags(baseArgs({ pollerSrc: "require('./reply-classifier');" }));
  assert.ok(!fixed.map(f => f.id).includes('poller_email_reply_gap'));
});

test('collectIntegrityFlags — flags elevated checker/diagnoser limits only when actually elevated', () => {
  const normal = collectIntegrityFlags(baseArgs());
  assert.ok(!normal.map(f => f.id).includes('checker_limit_elevated'));

  const elevated = collectIntegrityFlags(baseArgs({ checkerConfig: { daily_limit: 250 } }));
  assert.ok(elevated.map(f => f.id).includes('checker_limit_elevated'));
  assert.ok(elevated.find(f => f.id === 'checker_limit_elevated').message.includes('250'));
});

test('collectIntegrityFlags — flags unmeasured Apollo only when phone-only attempted is zero', () => {
  const unmeasured = collectIntegrityFlags(baseArgs({ apollo: { phoneOnly: { attempted: 0 }, hasWebsite: { attempted: 0 } } }));
  assert.ok(unmeasured.map(f => f.id).includes('apollo_unmeasured'));

  const measured = collectIntegrityFlags(baseArgs());
  assert.ok(!measured.map(f => f.id).includes('apollo_unmeasured'));
});

test('collectIntegrityFlags — flags missing pitcher config rather than crashing', () => {
  const flags = collectIntegrityFlags(baseArgs({ pitcherConfig: null }));
  assert.ok(flags.map(f => f.id).includes('pitcher_config_missing'));
});

test('NORMAL_DAILY_LIMIT is 30, matching the documented value', () => {
  assert.equal(NORMAL_DAILY_LIMIT, 30);
});

test('collectPipelineSnapshot — live smoke test against the real repo, structural only', () => {
  const snapshot = collectPipelineSnapshot();
  assert.ok(snapshot.funnel);
  assert.ok(snapshot.apollo.phoneOnly);
  assert.ok(Array.isArray(snapshot.integrityFlags));
  assert.ok(snapshot.integrityFlags.length >= 2, 'the two standing flags always present');
});
