'use strict';
/**
 * Tests for the daily approval gate.
 *
 * The property that matters most: a batch that Dave has NOT approved must send
 * nothing. Silence is the safe default — a bug here means unreviewed contacts
 * get cold-emailed, which is the exact outcome the gate exists to prevent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  STATUS, createBatch, approveBatch, rejectBatch, markSent,
  getBatch, nextSendableBatch, approvedLeadIds, pendingBatches, loadStore,
} = require('../lib/lead-batches');

function tmpStore() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'batches-')), 'lead-batches.json');
}
const LEADS = [
  { lead_id: 'a1', business_name: 'Acme Plumbing', email: 'a@acme.com', city: 'Boulder, CO', trade: 'plumber' },
  { lead_id: 'b2', business_name: 'Bolt Electric', email: 'b@bolt.com', city: 'Boulder, CO', trade: 'plumber' },
];

test('a new batch starts pending — never auto-approved', () => {
  const sp = tmpStore();
  const { batch } = createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  assert.equal(batch.status, STATUS.PENDING);
  assert.equal(batch.approvedAt, null);
});

test('a pending batch contributes NO sendable lead ids', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  const store = loadStore(sp);
  assert.equal(approvedLeadIds('2026-07-29', { store }).size, 0, 'pending must never send');
});

test('approval unlocks exactly the batch lead ids', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  approveBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  const ids = approvedLeadIds('2026-07-29', { store: loadStore(sp) });
  assert.deepEqual([...ids].sort(), ['a1', 'b2']);
});

test('a rejected batch stays unsendable', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  rejectBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  assert.equal(approvedLeadIds('2026-07-29', { store: loadStore(sp) }).size, 0);
});

test('nextSendableBatch returns approved-only, oldest first', () => {
  const sp = tmpStore();
  let store = { batches: {} };
  createBatch('2026-07-29', LEADS, { store, storePath: sp });
  createBatch('2026-07-30', LEADS, { store: loadStore(sp), storePath: sp });
  // Only the later one is approved.
  approveBatch('2026-07-30', { store: loadStore(sp), storePath: sp });
  const next = nextSendableBatch({ store: loadStore(sp) });
  assert.equal(next.date, '2026-07-30', 'pending 07-29 must be skipped, not sent');
});

test('a sent batch cannot be re-approved or re-sent', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  approveBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  markSent('2026-07-29', { store: loadStore(sp), storePath: sp });
  const res = approveBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  assert.equal(res.ok, false, 'must refuse to reopen a sent batch');
  assert.equal(getBatch('2026-07-29', { store: loadStore(sp) }).status, STATUS.SENT);
});

test('re-running the same day does not clobber an approval', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  approveBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  const again = createBatch('2026-07-29', [], { store: loadStore(sp), storePath: sp });
  assert.equal(again.created, false, 'must not reset an approved batch back to pending');
  assert.equal(getBatch('2026-07-29', { store: loadStore(sp) }).status, STATUS.APPROVED);
});

test('pendingBatches lists only what still needs review', () => {
  const sp = tmpStore();
  createBatch('2026-07-29', LEADS, { store: { batches: {} }, storePath: sp });
  createBatch('2026-07-30', LEADS, { store: loadStore(sp), storePath: sp });
  approveBatch('2026-07-29', { store: loadStore(sp), storePath: sp });
  const pend = pendingBatches({ store: loadStore(sp) });
  assert.deepEqual(pend.map(b => b.date), ['2026-07-30']);
});

test('a missing batch yields no ids rather than throwing', () => {
  assert.equal(approvedLeadIds('1999-01-01', { store: { batches: {} } }).size, 0);
});
