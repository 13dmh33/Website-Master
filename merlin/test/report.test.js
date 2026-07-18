'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../lib/report');
const { isActorEnabled, assertActorNotImplemented } = require('../lib/actor-gate');
const { buildEmailBody, RECIPIENT } = require('../lib/mailer');

function fixture() {
  return {
    gitHealth: { branches: [{ name: 'main', stale: false, unpushed: false, mergedIntoOriginMain: true }], mainDivergence: { ahead: 0, behind: 0 }, untrackedDirs: [] },
    pipelineSnapshot: {
      funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 458, conversionPct: 26.5 }, cumulativeReached: { scouted: 636, sent: 165 } },
      apollo: { phoneOnly: { attempted: 0, hits: 0, hitRatePct: null }, hasWebsite: { attempted: 0, hits: 0, hitRatePct: null } },
      integrityFlags: [{ severity: 'high', message: 'test flag' }],
    },
    costAudit: { month: '2026-07', actualTotalUsd: 1.28, costPerOutcomeNote: 'n/a', projections: [], assumptions: ['test assumption'] },
    ranking: { ranked: [{ label: 'Clear backlog', score: 27, revenueProximity: 9, buildVolume: 0, effortHours: 0.1, why: 'why' }], recommendation: { label: 'Clear backlog', why: 'why', buildVolume: 0 } },
    primaryQueueHours: 3.45,
    lightQueueHours: 1.25,
  };
}

test('buildReport — includes the recommendation, funnel, and integrity caveats', () => {
  const report = buildReport(fixture());
  assert.ok(report.includes('Clear backlog'));
  assert.ok(report.includes('zero-build, don\'t-build recommendation'));
  assert.ok(report.includes('test flag'));
  assert.ok(report.includes('$1.28'));
});

test('buildReport — never claims a definitive recommendation when ranking is empty', () => {
  const f = fixture();
  f.ranking = { ranked: [], recommendation: null };
  const report = buildReport(f);
  assert.ok(report.includes('No candidates scored'));
});

test('buildReport — states advisor-only up front', () => {
  const report = buildReport(fixture());
  assert.ok(report.toLowerCase().includes('advisor-only') || report.toLowerCase().includes('advisor only'));
});

test('buildReport — brand compliance: no emojis, no "bot", no "business days"', () => {
  const report = buildReport(fixture());
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiPattern.test(report), false);
  assert.equal(/\bbot\b/i.test(report), false);
  assert.equal(/business\s+days?/i.test(report), false);
});

test('actor-gate — isActorEnabled always returns false', () => {
  assert.equal(isActorEnabled(), false);
  process.env.MERLIN_ACTOR = 'true'; // even if someone sets this, no implementation reads it
  assert.equal(isActorEnabled(), false);
  delete process.env.MERLIN_ACTOR;
});

test('actor-gate — assertActorNotImplemented always throws', () => {
  assert.throws(() => assertActorNotImplemented(), /no implementation/);
});

test('mailer — buildEmailBody includes both prompts and the report, RECIPIENT is the right address', () => {
  const body = buildEmailBody({ report: 'REPORT_TEXT', primaryPrompt: 'PRIMARY_TEXT', lightPrompt: 'LIGHT_TEXT' });
  assert.ok(body.includes('REPORT_TEXT'));
  assert.ok(body.includes('PRIMARY_TEXT'));
  assert.ok(body.includes('LIGHT_TEXT'));
  assert.equal(RECIPIENT, '13dmh33@gmail.com');
});
