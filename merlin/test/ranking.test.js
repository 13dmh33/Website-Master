'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreCandidate, rankCandidates, buildRanking, dynamicCandidates, staticCandidates,
  REVENUE_WEIGHT, BUILD_PENALTY_WEIGHT,
} = require('../lib/ranking');

test('scoreCandidate — revenue proximity is weighted above build volume (the hard rule)', () => {
  assert.ok(REVENUE_WEIGHT > BUILD_PENALTY_WEIGHT, 'revenue weight must exceed build penalty weight');
});

test('scoreCandidate — a high-revenue-proximity zero-build candidate beats a low-revenue high-build one', () => {
  const manualAction = { revenueProximity: 9, buildVolume: 0 };
  const newFeature = { revenueProximity: 3, buildVolume: 8 };
  assert.ok(scoreCandidate(manualAction) > scoreCandidate(newFeature));
});

test('rankCandidates — sorts descending by score', () => {
  const candidates = [
    { id: 'a', revenueProximity: 5, buildVolume: 5 }, // score: 15-5=10
    { id: 'b', revenueProximity: 5, buildVolume: 2 }, // score: 15-2=13
  ];
  const ranked = rankCandidates(candidates);
  assert.equal(ranked[0].id, 'b', 'b has the higher score and should rank first');
});

test('rankCandidates — an exact score tie is broken toward the lower build volume', () => {
  const candidates = [
    { id: 'x', revenueProximity: 4, buildVolume: 2 }, // score: 12-2=10
    { id: 'y', revenueProximity: 5, buildVolume: 5 }, // score: 15-5=10, same score, lower revenueProximity edge but tie logic is on buildVolume
  ];
  const ranked = rankCandidates(candidates);
  assert.equal(ranked[0].id, 'x', 'x has the lower build volume and wins the tiebreak');
});

test('dynamicCandidates — generates a "clear backlog" candidate with zero build volume when backlog exists', () => {
  const candidates = dynamicCandidates({
    pipelineSnapshot: {
      sendActivity: { backlogAtChecked: 458, dailyLimit: 30, daysToClearBacklogAtCurrentCap: 16 },
      funnel: { biggestDropoff: null },
    },
  });
  const backlogCandidate = candidates.find(c => c.id === 'clear_send_backlog');
  assert.ok(backlogCandidate);
  assert.equal(backlogCandidate.buildVolume, 0);
  assert.ok(backlogCandidate.revenueProximity >= 8);
});

test('dynamicCandidates — generates no backlog candidate when backlog is zero', () => {
  const candidates = dynamicCandidates({
    pipelineSnapshot: { sendActivity: { backlogAtChecked: 0 }, funnel: { biggestDropoff: null } },
  });
  assert.ok(!candidates.some(c => c.id === 'clear_send_backlog'));
});

test('buildRanking — is capable of recommending a zero-build-volume move (the "don\'t build" requirement)', () => {
  // Realistic scenario matching this session's actual live data: large backlog, no code candidate should win.
  const result = buildRanking({
    pipelineSnapshot: {
      sendActivity: { backlogAtChecked: 458, dailyLimit: 30, daysToClearBacklogAtCurrentCap: 16 },
      funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 458, conversionPct: 26.5 } },
    },
  });
  assert.ok(result.recommendation, 'must produce a recommendation');
  assert.equal(result.recommendation.buildVolume, 0, 'the top recommendation in this scenario must be a zero-build action');
  assert.equal(result.recommendationIsDontBuild, true);
});

test('buildRanking — every static candidate has all required fields, no silent gaps', () => {
  for (const c of staticCandidates()) {
    assert.ok(c.id && c.label && c.category && c.why, `candidate ${c.id} missing required narrative fields`);
    assert.ok(typeof c.revenueProximity === 'number' && typeof c.buildVolume === 'number' && typeof c.effortHours === 'number');
  }
});

test('buildRanking — never throws when pipelineSnapshot has no dynamic signal at all', () => {
  assert.doesNotThrow(() => buildRanking({ pipelineSnapshot: { sendActivity: null, funnel: { biggestDropoff: null } } }));
});
