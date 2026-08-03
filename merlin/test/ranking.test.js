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

test('buildRanking — a decision supersedes its candidate: dropped from ranked, kept in superseded (Task 10b)', () => {
  const decisions = {
    isSuperseded: (id) => id === 'clear_send_backlog',
    decisionFor: (id) => (id === 'clear_send_backlog' ? { id: 'backlog-is-arithmetic', date: '2026-07-19', decision: 'arithmetic' } : null),
    explanationFor: () => null,
  };
  const result = buildRanking({
    pipelineSnapshot: {
      sendActivity: { backlogAtChecked: 458, dailyLimit: 30, daysToClearBacklogAtCurrentCap: 16 },
      funnel: { biggestDropoff: null },
      integrityFlags: [],
    },
    decisions,
  });
  assert.ok(!result.ranked.some(c => c.id === 'clear_send_backlog'), 'superseded candidate must not be ranked');
  assert.ok(result.superseded.some(c => c.id === 'clear_send_backlog'), 'superseded candidate must be recorded transparently');
  assert.notEqual(result.recommendation.id, 'clear_send_backlog');
});

test('buildRanking — repo-facts resolution drops an already-done candidate into resolved (Task 10a)', () => {
  const repoFacts = {
    isResolved: (id) => id === 'fix_poller_email_reply_gap',
    noteFor: (id) => 'Already done: poller.js references reply-classifier.',
  };
  const result = buildRanking({
    pipelineSnapshot: { sendActivity: null, funnel: { biggestDropoff: null }, integrityFlags: [] },
    repoFacts,
  });
  assert.ok(!result.ranked.some(c => c.id === 'fix_poller_email_reply_gap'));
  assert.ok(result.resolved.some(c => c.id === 'fix_poller_email_reply_gap'));
  assert.ok(result.resolved.find(c => c.id === 'fix_poller_email_reply_gap').resolutionNote.includes('Already done'));
});

test('dynamicCandidates — generates an unstall candidate for a stalled stage (Task 10c)', () => {
  const candidates = dynamicCandidates({
    pipelineSnapshot: {
      sendActivity: { backlogAtChecked: 0 },
      funnel: { biggestDropoff: null, stalledStages: [{ stage: 'sent', reached: 167, waiting: 149 }] },
    },
  });
  const stall = candidates.find(c => c.id === 'unstall_sent');
  assert.ok(stall, 'a stalled stage must produce an unstall candidate');
  assert.equal(stall.buildVolume, 0);
  assert.equal(stall.executor, 'claude_code');
});

test('buildRanking — cross-references a surviving drop-off against an explaining decision (Task 10d)', () => {
  const decisions = {
    isSuperseded: () => false,
    decisionFor: () => null,
    explanationFor: (flagId) => (flagId === 'checker_limit_elevated'
      ? { id: 'backlog-is-arithmetic', decision: 'arithmetic' } : null),
  };
  const result = buildRanking({
    pipelineSnapshot: {
      sendActivity: null,
      funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 400, conversionPct: 26 } },
      integrityFlags: [{ id: 'checker_limit_elevated', severity: 'low', message: 'elevated' }],
    },
    decisions,
  });
  const dropoff = result.ranked.find(c => c.id === 'investigate_biggest_dropoff');
  assert.ok(dropoff.caveats && dropoff.caveats.length > 0, 'the drop-off candidate must carry a cross-reference caveat');
  assert.ok(dropoff.why.includes('backlog-is-arithmetic'));
});

test('dropoffIsExplained — a mostly-blocked stage is arithmetic, not a leak to investigate', () => {
  const { dropoffIsExplained } = require('../lib/ranking');
  // Real 2026-08-03 shape: 566 at 'checked', only 59 able to send.
  const explained = dropoffIsExplained({
    funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 566 } },
    actionableBacklog: { stage: 'checked', total: 566, sendable: 59, awaitingApproval: 30, noBrief: 205, blocked: 272 },
  });
  assert.equal(explained, true);
});

test('dropoffIsExplained — a genuinely converting stage is NOT explained away', () => {
  const { dropoffIsExplained } = require('../lib/ranking');
  // Same drop-off, but almost everything is sendable — leads are being lost
  // for a reason the blockers do not account for, which is worth investigating.
  const explained = dropoffIsExplained({
    funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 400 } },
    actionableBacklog: { stage: 'checked', total: 500, sendable: 450, awaitingApproval: 20, noBrief: 15, blocked: 15 },
  });
  assert.equal(explained, false, 'the candidate must return once the structural blockers clear');
});

test('dropoffIsExplained — only explains the transition into the measured stage', () => {
  const { dropoffIsExplained } = require('../lib/ranking');
  const elsewhere = dropoffIsExplained({
    funnel: { biggestDropoff: { from: 'sent', to: 'replied', lost: 200 } },
    actionableBacklog: { stage: 'checked', total: 566, sendable: 59, noBrief: 205, blocked: 272 },
  });
  assert.equal(elsewhere, false, 'a drop-off at a different step is a different question');
});

test('dropoffIsExplained — missing or empty data never explains anything away', () => {
  const { dropoffIsExplained } = require('../lib/ranking');
  assert.equal(dropoffIsExplained({}), false);
  assert.equal(dropoffIsExplained({ funnel: { biggestDropoff: { to: 'sent' } }, actionableBacklog: null }), false);
  assert.equal(dropoffIsExplained({
    funnel: { biggestDropoff: { to: 'sent' } },
    actionableBacklog: { stage: 'checked', total: 0 },
  }), false, 'an empty stage is not evidence');
});

test('dynamicCandidates — omits the dropoff candidate when it is already explained', () => {
  const { dynamicCandidates } = require('../lib/ranking');
  const snapshot = {
    funnel: { biggestDropoff: { from: 'checked', to: 'sent', lost: 566, conversionPct: 30.3 }, stalledStages: [] },
    actionableBacklog: { stage: 'checked', total: 566, sendable: 59, awaitingApproval: 30, noBrief: 205, blocked: 272 },
  };
  const ids = dynamicCandidates({ pipelineSnapshot: snapshot }).map(c => c.id);
  assert.equal(ids.includes('investigate_biggest_dropoff'), false);

  // and it comes back when the blockers clear
  snapshot.actionableBacklog = { stage: 'checked', total: 566, sendable: 500, awaitingApproval: 30, noBrief: 20, blocked: 16 };
  const idsAfter = dynamicCandidates({ pipelineSnapshot: snapshot }).map(c => c.id);
  assert.ok(idsAfter.includes('investigate_biggest_dropoff'), 'not suppressed permanently');
});
