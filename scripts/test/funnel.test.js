const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { computeFunnel, computeRawCounts, computeCumulativeReached, computeTransitions, biggestDropoff } = require('../lib/funnel');

function q(statuses) {
  return statuses.map((status, i) => ({ lead_id: `L${i}`, status }));
}

test('computeRawCounts — tallies current status exactly, no interpretation', () => {
  const counts = computeRawCounts(q(['checked', 'checked', 'sent', 'unsubscribed']));
  assert.deepEqual(counts, { checked: 2, sent: 1, unsubscribed: 1 });
});

test('computeCumulativeReached — a lead at "sent" counts toward every earlier stage too', () => {
  const reached = computeCumulativeReached(q(['sent']));
  assert.equal(reached.scouted, 1);
  assert.equal(reached.diagnosed, 1);
  assert.equal(reached.checked, 1);
  assert.equal(reached.sent, 1);
  assert.equal(reached.drip_d1_sent, 0, 'has not reached drip yet');
  assert.equal(reached.replied, 0);
});

test('computeCumulativeReached — unresponsive anchors at drip_d2_sent (full drip exhausted, never replied)', () => {
  const reached = computeCumulativeReached(q(['unresponsive']));
  assert.equal(reached.sent, 1);
  assert.equal(reached.drip_d2_sent, 1);
  assert.equal(reached.replied, 0, 'unresponsive never reached replied by definition');
});

test('computeCumulativeReached — unsubscribed anchors at sent (unknown drip depth, conservative floor)', () => {
  const reached = computeCumulativeReached(q(['unsubscribed']));
  assert.equal(reached.sent, 1);
  assert.equal(reached.drip_d1_sent, 0);
});

test('computeCumulativeReached — closed anchors at scouted (every real closed_reason was pre-send)', () => {
  const reached = computeCumulativeReached(q(['closed']));
  assert.equal(reached.scouted, 1);
  assert.equal(reached.diagnosed, 0);
});

test('computeCumulativeReached — mockup_pending is excluded from the ranked funnel entirely', () => {
  const reached = computeCumulativeReached(q(['mockup_pending']));
  const total = Object.values(reached).reduce((a, b) => a + b, 0);
  assert.equal(total, 0, 'mockup_pending contributes to none of the ranked stages');
});

test('computeTransitions — conversion % and absolute lost are both correct', () => {
  const reached = computeCumulativeReached(q(['sent', 'sent', 'sent', 'sent', 'drip_d1_sent']));
  const transitions = computeTransitions(reached);
  const sentToDrip = transitions.find(t => t.from === 'sent' && t.to === 'drip_d1_sent');
  assert.equal(sentToDrip.countFrom, 5);
  assert.equal(sentToDrip.countTo, 1);
  assert.equal(sentToDrip.lost, 4);
  assert.equal(sentToDrip.conversionPct, 20);
});

test('biggestDropoff — flags the transition losing the most leads in absolute count, not just worst rate', () => {
  // checked->sent: 100 -> 10 (loses 90, 10% conversion)
  // sent->drip_d1_sent: 10 -> 9 (loses 1, 90% conversion)
  const queue = [
    ...q(Array(90).fill('checked')),
    ...q(Array(9).fill('sent')),
    ...q(['drip_d1_sent']),
  ];
  const reached = computeCumulativeReached(queue);
  const transitions = computeTransitions(reached);
  const worst = biggestDropoff(transitions);
  assert.equal(worst.from, 'checked');
  assert.equal(worst.to, 'sent');
  assert.equal(worst.lost, 90);
});

test('computeFunnel — never crashes on an empty queue', () => {
  const result = computeFunnel([]);
  assert.equal(result.biggestDropoff, null);
  assert.equal(result.mockupInProduction, 0);
});

test('computeFunnel — sanity check against the real state.json (structural, not a fixed-number assertion)', () => {
  const statePath = path.join(__dirname, '..', '..', 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const result = computeFunnel(state.queue);

  // Every rawCounts total must equal the real queue length — no lead silently dropped.
  const rawTotal = Object.values(result.rawCounts).reduce((a, b) => a + b, 0);
  assert.equal(rawTotal, state.queue.length);

  // cumulativeReached must be monotonically non-increasing along FUNNEL_ORDER.
  const { FUNNEL_ORDER } = require('../lib/funnel');
  for (let i = 1; i < FUNNEL_ORDER.length; i++) {
    assert.ok(
      result.cumulativeReached[FUNNEL_ORDER[i]] <= result.cumulativeReached[FUNNEL_ORDER[i - 1]],
      `${FUNNEL_ORDER[i]} should never exceed ${FUNNEL_ORDER[i - 1]}`
    );
  }
});

test('computeActionableBacklog — separates what can send from what is structurally stuck', () => {
  const { computeActionableBacklog } = require('../lib/funnel');
  const queue = [
    { lead_id: 'a', status: 'checked' },
    { lead_id: 'b', status: 'checked' },
    { lead_id: 'c', status: 'checked' },
    { lead_id: 'd', status: 'checked' },
    { lead_id: 'e', status: 'checked' },
    { lead_id: 'f', status: 'sent' },
  ];
  const briefs = {
    a: { channel: 'email', checker_approved: true },
    b: { channel: 'email', checker_approved: false },
    c: { channel: 'sms', checker_approved: true },
    d: { channel: 'sms', checker_approved: false },
    // 'e' deliberately has no brief
  };
  const r = computeActionableBacklog(queue, briefs);

  assert.equal(r.total, 5, 'only counts the requested stage, not the sent lead');
  assert.equal(r.sendable, 1, 'email + approved is the only sendable state');
  assert.equal(r.awaitingApproval, 1);
  assert.equal(r.noBrief, 1, 'a status with no brief file has nothing to send');
  assert.equal(r.blocked, 2, 'both sms leads are blocked regardless of approval');
  assert.equal(r.blockedByChannel.sms, 2);
  assert.equal(r.actionablePct, 20);
});

test('computeActionableBacklog — accepts a Map as well as a plain object, and handles an empty stage', () => {
  const { computeActionableBacklog } = require('../lib/funnel');
  const asMap = computeActionableBacklog(
    [{ lead_id: 'a', status: 'checked' }],
    new Map([['a', { channel: 'email', checker_approved: true }]]),
  );
  assert.equal(asMap.sendable, 1);

  const empty = computeActionableBacklog([], {});
  assert.equal(empty.total, 0);
  assert.equal(empty.actionablePct, null, 'no leads means undefined, not 0%');
});

test('computeActionableBacklog — real state.json: the checked backlog is mostly not actionable', () => {
  const { computeActionableBacklog } = require('../lib/funnel');
  const glob = require('fs').readdirSync(path.join(__dirname, '..', '..', 'queue'));
  const briefs = {};
  for (const f of glob) {
    if (!f.endsWith('-brief.json')) continue;
    try {
      const b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'queue', f), 'utf8'));
      if (b.lead_id) briefs[b.lead_id] = b;
    } catch { /* skip unreadable */ }
  }
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'state.json'), 'utf8'));
  const r = computeActionableBacklog(state.queue, briefs);

  // Structural, not fixed numbers — the data moves daily.
  assert.equal(r.sendable + r.awaitingApproval + r.noBrief + r.blocked, r.total, 'every lead is accounted for exactly once');
  assert.ok(r.sendable <= r.total);
});
