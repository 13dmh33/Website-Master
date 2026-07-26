'use strict';
/**
 * Regression guard for the Checker state-gate (2026-07-24, -26). Checker used to
 * process ANY brief with checker_approved=false, ignoring the lead's live state,
 * so a stale brief for a settled lead got re-checked and its status clobbered
 * back to 'checked' — this un-suppressed an opt-out twice. isCheckable now also
 * requires the lead to still be 'diagnosed'.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCheckable } = require('../checker.js');

const fresh = { checker_approved: false, checker_flag: '' };

test('isCheckable — a fresh unchecked brief on a diagnosed lead IS checkable', () => {
  assert.equal(isCheckable(fresh, 'diagnosed'), true);
});

test('isCheckable — a settled lead is NEVER re-checked, even with an unchecked brief', () => {
  for (const status of ['checked', 'sent', 'drip_d1_sent', 'unsubscribed', 'closed', 'positive']) {
    assert.equal(isCheckable(fresh, status), false, `status ${status} must not be re-checkable`);
  }
});

test('isCheckable — the opt-out clobber that bit us: unsubscribed lead is skipped', () => {
  assert.equal(isCheckable(fresh, 'unsubscribed'), false);
});

test('isCheckable — already-approved or human-review briefs are skipped even if diagnosed', () => {
  assert.equal(isCheckable({ checker_approved: true, checker_flag: '' }, 'diagnosed'), false);
  assert.equal(isCheckable({ checker_approved: false, checker_flag: 'human_review' }, 'diagnosed'), false);
});

test('isCheckable — a lead missing from state (undefined status) is not checkable', () => {
  assert.equal(isCheckable(fresh, undefined), false);
});
