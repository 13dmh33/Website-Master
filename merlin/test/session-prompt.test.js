'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionQueue, lightAlternateQueue, buildSessionPrompts, splitByExecutor, renderExecutorLists, PRIMARY_TARGET_HOURS, slugify } = require('../lib/session-prompt');

function candidate(id, revenueProximity, buildVolume, effortHours, executor) {
  return { id, label: `Do ${id}`, category: buildVolume === 0 ? 'manual_sales_action' : 'code_build', revenueProximity, buildVolume, effortHours, why: `why ${id}`, executor };
}

test('buildSessionQueue — stops once the target hours is reached, does not overshoot needlessly', () => {
  const candidates = [candidate('a', 9, 0, 1), candidate('b', 8, 0, 1), candidate('c', 7, 0, 1), candidate('d', 6, 0, 1)];
  const queue = buildSessionQueue(candidates, 2.5);
  assert.equal(queue.items.length, 3, 'takes a, b, c to cross 2.5h (1+1+1=3 >= 2.5)');
  assert.equal(queue.totalHours, 3);
});

test('buildSessionQueue — includes everything if the whole list never reaches the target', () => {
  const candidates = [candidate('a', 9, 0, 0.1), candidate('b', 8, 0, 0.1)];
  const queue = buildSessionQueue(candidates, 2.5);
  assert.equal(queue.items.length, 2);
  assert.equal(queue.totalHours, 0.2);
});

test('lightAlternateQueue — includes only zero-build-volume candidates', () => {
  const candidates = [candidate('a', 9, 0, 0.5), candidate('b', 7, 5, 3), candidate('c', 6, 0, 0.25)];
  const queue = lightAlternateQueue(candidates);
  assert.deepEqual(queue.items.map(c => c.id), ['a', 'c']);
});

test('slugify — produces a safe branch-name fragment', () => {
  assert.equal(slugify('Clear the 458-lead backlog!'), 'clear-the-458-lead-backlog');
});

test('buildSessionPrompts — primary queue meets or reasonably approaches the 50% target when enough candidates exist', () => {
  const ranked = [
    candidate('a', 9, 0, 0.1), candidate('b', 8, 0, 0.5), candidate('c', 7, 3, 1.5),
    candidate('d', 6, 2, 1), candidate('e', 5, 5, 3),
  ];
  const { primaryQueue } = buildSessionPrompts({ ranking: { ranked, recommendation: ranked[0] }, generatedFor: 'test' });
  assert.ok(primaryQueue.totalHours >= PRIMARY_TARGET_HOURS);
});

test('buildSessionPrompts — both prompts are non-empty strings containing the standing structure markers', () => {
  const ranked = [candidate('a', 9, 0, 3)];
  const { primary, light } = buildSessionPrompts({ ranking: { ranked, recommendation: ranked[0] }, generatedFor: 'test' });
  for (const prompt of [primary, light]) {
    assert.ok(prompt.includes('Phase 0 state audit'));
    assert.ok(prompt.includes('Living `CHECKPOINT.md`') || prompt.includes('CHECKPOINT.md'));
    assert.ok(prompt.includes('Priority queue'));
    assert.ok(prompt.includes('AI agent'));
  }
});

test('buildSessionPrompts — never throws with an empty candidate list', () => {
  assert.doesNotThrow(() => buildSessionPrompts({ ranking: { ranked: [], recommendation: null }, generatedFor: 'test' }));
});

test('buildSessionPrompts — brand compliance: no emojis, sentence case, no "business days"', () => {
  const ranked = [candidate('a', 9, 0, 3)];
  const { primary } = buildSessionPrompts({ ranking: { ranked, recommendation: ranked[0] }, generatedFor: 'test' });
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiPattern.test(primary), false);
  assert.equal(/business\s+days?/i.test(primary), false);
});

test('splitByExecutor — dave-executor items separate from claude-code; unclassified defaults to claude-code (Task 11)', () => {
  const items = [
    candidate('stripe', 8, 0, 0.25, 'dave'),
    candidate('poller', 4, 3, 1.5, 'claude_code'),
    candidate('mystery', 5, 0, 0.5, undefined), // unclassified
  ];
  const { dave, claudeCode } = splitByExecutor(items);
  assert.deepEqual(dave.map(c => c.id), ['stripe']);
  assert.deepEqual(claudeCode.map(c => c.id).sort(), ['mystery', 'poller']);
});

test('renderExecutorLists — always shows both a Claude Code section and a Dave section', () => {
  const md = renderExecutorLists([candidate('stripe', 8, 0, 0.25, 'dave')]);
  assert.ok(/Claude Code tasks/.test(md));
  assert.ok(/Dave's tasks/.test(md));
  // The one dave item lands under Dave's section and Claude Code shows the empty marker.
  assert.ok(/Dave's tasks[\s\S]*Do stripe/.test(md));
});

test('buildSessionPrompts — the rendered prompt carries both executor lanes (Task 11)', () => {
  const ranked = [candidate('stripe', 8, 0, 0.25, 'dave'), candidate('poller', 4, 3, 1.5, 'claude_code')];
  const { primary } = buildSessionPrompts({ ranking: { ranked, recommendation: ranked[0] }, generatedFor: 'test' });
  assert.ok(primary.includes('Claude Code tasks'));
  assert.ok(primary.includes("Dave's tasks"));
});

test('renderSessionPrompt — a dave-executor blocker is never front-loaded as agent Task 0', () => {
  // Regression for 2026-07-31: the Stripe candidate (non_code_blocker,
  // executor 'dave') opened the generated session as "Task 0" under a heading
  // that reads "this session executes these" — work the agent structurally
  // cannot do — and the slice that removes Task 0 from the remaining queue
  // then dropped it out of Dave's list too, so the one person who could do it
  // never saw it.
  const daveBlocker = { ...candidate('stripe', 8, 0, 0.25, 'dave'), category: 'non_code_blocker' };
  const agentTask = candidate('poller', 4, 3, 1.5, 'claude_code');
  const { primary } = buildSessionPrompts({
    ranking: { ranked: [daveBlocker, agentTask], recommendation: daveBlocker },
    generatedFor: 'test',
  });
  assert.equal(/## Task 0/.test(primary), false, 'no Task 0 section when the top item is dave-only');
  assert.ok(/Dave's tasks[\s\S]*Do stripe/.test(primary), 'it stays in Dave\'s list instead');
});

test('renderSessionPrompt — an agent-executable blocker is still front-loaded as Task 0', () => {
  const agentBlocker = { ...candidate('unblock', 7, 0, 0.5, 'claude_code'), category: 'non_code_blocker' };
  const { primary } = buildSessionPrompts({
    ranking: { ranked: [agentBlocker], recommendation: agentBlocker },
    generatedFor: 'test',
  });
  assert.ok(/## Task 0/.test(primary), 'front-loading still happens for work the agent can do');
});
