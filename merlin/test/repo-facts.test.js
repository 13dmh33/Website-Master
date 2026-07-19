'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectRepoFacts, buildResolvers } = require('../lib/repo-facts');

test('buildResolvers — revert_elevated_daily_limits resolves only when both limits are <= 30', () => {
  const resolved = buildResolvers({
    readJson: (rel) => ({ daily_limit: 30 }),
  }).revert_elevated_daily_limits();
  assert.equal(resolved.resolved, true);

  const elevated = buildResolvers({
    readJson: (rel) => (rel.includes('checker') ? { daily_limit: 120 } : { daily_limit: 30 }),
  }).revert_elevated_daily_limits();
  assert.equal(elevated.resolved, false);
});

test('buildResolvers — fix_poller_email_reply_gap resolves when poller.js references reply-classifier', () => {
  const done = buildResolvers({
    readFile: () => "require('./reply-classifier');",
  }).fix_poller_email_reply_gap();
  assert.equal(done.resolved, true);

  const notDone = buildResolvers({
    readFile: () => 'const imap = require("imapflow");',
  }).fix_poller_email_reply_gap();
  assert.equal(notDone.resolved, false);
});

test('buildResolvers — merge_nora_and_funnel_metrics resolves only when both are present on main', () => {
  const done = buildResolvers({
    readFile: (rel) => 'file contents', // both nora/CLAUDE.md and funnel.js return non-null
  }).merge_nora_and_funnel_metrics();
  assert.equal(done.resolved, true);

  const noNora = buildResolvers({
    readFile: (rel) => (rel.includes('nora') ? null : 'funnel contents'),
    exec: () => '', // not on any branch either
  }).merge_nora_and_funnel_metrics();
  assert.equal(noNora.resolved, false);
});

test('collectRepoFacts — returns a resolvedIds map with isResolved/noteFor helpers', () => {
  const facts = collectRepoFacts({
    readJson: () => ({ daily_limit: 30 }),
    readFile: () => "require('./reply-classifier');",
  });
  assert.ok(facts.isResolved('revert_elevated_daily_limits'));
  assert.ok(facts.isResolved('fix_poller_email_reply_gap'));
  assert.ok(typeof facts.noteFor('revert_elevated_daily_limits') === 'string');
  assert.equal(facts.isResolved('enable_zoho_imap'), false); // not machine-resolvable — never auto-dropped
});
