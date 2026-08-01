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

test('buildResolvers — add_stripe_key resolves once a live Payment Link exists', () => {
  // Real 2026-07-31 shape: live constants sitting below a stale setup comment
  // that still names the old STRIPE_PAYMENT_LINK placeholder. Keying on that
  // word's absence would report "not done" forever, so the marker is a real
  // hosted buy.stripe.com link.
  const done = buildResolvers({
    readFile: () => `
      <!-- SETUP: Replace STRIPE_PAYMENT_LINK below with your real Payment Link URL. -->
      const STRIPE_LINK_WEBSITE = 'https://buy.stripe.com/6oU5kC6VdaLS0BceGL8og02';
      const STRIPE_LINK_NORA    = 'https://buy.stripe.com/5kQeVccfx07ecjUdCH8og03';
    `,
  }).add_stripe_key();
  assert.equal(done.resolved, true, 'live links resolve even with the stale placeholder comment present');
  assert.ok(/no STRIPE_SECRET_KEY is required/.test(done.note));

  const notDone = buildResolvers({
    readFile: () => `const STRIPE_LINK_WEBSITE = 'STRIPE_PAYMENT_LINK';`,
  }).add_stripe_key();
  assert.equal(notDone.resolved, false);

  const noFile = buildResolvers({ readFile: () => null }).add_stripe_key();
  assert.equal(noFile.resolved, false, 'a missing checkout page is not "done"');
});
