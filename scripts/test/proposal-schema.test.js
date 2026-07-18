'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProposalInput } = require('../lib/proposal/schema');

function validBase() {
  return {
    leadId: 'lead-1',
    trade: 'plumber',
    painPoint: 'Missing after-hours calls',
    package: 'growth',
  };
}

test('validateProposalInput — accepts a minimal valid input', () => {
  assert.doesNotThrow(() => validateProposalInput(validBase()));
});

test('validateProposalInput — throws on missing leadId', () => {
  const input = validBase();
  delete input.leadId;
  assert.throws(() => validateProposalInput(input), /leadId is required/);
});

test('validateProposalInput — throws on missing painPoint', () => {
  const input = validBase();
  delete input.painPoint;
  assert.throws(() => validateProposalInput(input), /painPoint is required/);
});

test('validateProposalInput — throws on unknown package', () => {
  const input = validBase();
  input.package = 'enterprise';
  assert.throws(() => validateProposalInput(input), /package must be one of/);
});

test('validateProposalInput — throws on missing package', () => {
  const input = validBase();
  delete input.package;
  assert.throws(() => validateProposalInput(input), /package must be one of/);
});

test('validateProposalInput — accepts valid customLineItems', () => {
  const input = validBase();
  input.customLineItems = [{ label: 'Rush setup', amountUsd: 50 }];
  assert.doesNotThrow(() => validateProposalInput(input));
});

test('validateProposalInput — throws on a negative customLineItems amount', () => {
  const input = validBase();
  input.customLineItems = [{ label: 'Discount', amountUsd: -10 }];
  assert.throws(() => validateProposalInput(input), /non-negative number/);
});

test('validateProposalInput — throws on a customLineItems entry missing label', () => {
  const input = validBase();
  input.customLineItems = [{ amountUsd: 10 }];
  assert.throws(() => validateProposalInput(input), /label is required/);
});
