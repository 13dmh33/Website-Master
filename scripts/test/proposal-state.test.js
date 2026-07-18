'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordProposalSent } = require('../lib/proposal/state');

function makeTempState(queue) {
  const file = path.join(os.tmpdir(), `proposal-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ queue, active: [], closed: [], nora_pipeline: [], last_run: null, daily_stats: {} }, null, 2));
  return file;
}

test('recordProposalSent — adds the 4 new fields additively, preserves existing fields', () => {
  const statePath = makeTempState([
    { lead_id: 'L1', status: 'hot', added_at: '2026-01-01T00:00:00.000Z', checked_at: '2026-01-02T00:00:00.000Z' },
  ]);
  const entry = recordProposalSent('L1', { packageId: 'growth', amountUsd: 497, stripeSessionId: 'cs_test_123' }, statePath);

  assert.equal(entry.proposalPackage, 'growth');
  assert.equal(entry.proposalAmount, 497);
  assert.equal(entry.stripeSessionId, 'cs_test_123');
  assert.ok(entry.proposalSentAt);
  // existing fields untouched
  assert.equal(entry.status, 'hot');
  assert.equal(entry.added_at, '2026-01-01T00:00:00.000Z');
  assert.equal(entry.checked_at, '2026-01-02T00:00:00.000Z');

  fs.unlinkSync(statePath);
});

test('recordProposalSent — throws loud when the leadId is not found, writes nothing', () => {
  const statePath = makeTempState([{ lead_id: 'L1', status: 'hot' }]);
  const before = fs.readFileSync(statePath, 'utf8');
  assert.throws(
    () => recordProposalSent('does-not-exist', { packageId: 'starter', amountUsd: 100 }, statePath),
    /no state\.json queue entry found/
  );
  const after = fs.readFileSync(statePath, 'utf8');
  assert.equal(before, after, 'file must be unchanged after a failed lookup');
  fs.unlinkSync(statePath);
});

test('recordProposalSent — stripeSessionId defaults to null when not provided (e.g. no Stripe key)', () => {
  const statePath = makeTempState([{ lead_id: 'L1', status: 'hot' }]);
  const entry = recordProposalSent('L1', { packageId: 'starter', amountUsd: 100 }, statePath);
  assert.equal(entry.stripeSessionId, null);
  fs.unlinkSync(statePath);
});
