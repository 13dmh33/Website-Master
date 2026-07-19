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

test('collectIntegrityFlags — always includes the two standing gaps regardless of config', () => {
  const flags = collectIntegrityFlags(baseArgs());
  const ids = flags.map(f => f.id);
  assert.ok(ids.includes('poller_email_reply_gap'));
  assert.ok(ids.includes('closed_not_won'));
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
