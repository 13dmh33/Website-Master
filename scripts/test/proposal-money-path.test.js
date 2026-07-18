'use strict';
/**
 * Cross-module money-path tests — the ones that cost real money if wrong.
 * Composes the actual modules generate-proposal.js wires together, rather
 * than re-testing each module's internals (already covered in their own
 * test files), to catch drift between what the proposal shows a customer
 * and what Stripe would actually charge them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getPackage } = require('../lib/proposal/packages');
const { buildCheckoutSessionParams } = require('../lib/proposal/stripe');
const { renderProposal } = require('../lib/proposal/template');
const { validateProposalInput } = require('../lib/proposal/schema');

function centsOf(usdStr) {
  return Math.round(parseFloat(usdStr.replace(/[$,]/g, '')) * 100);
}

for (const packageId of ['starter', 'growth', 'pro']) {
  test(`money path — ${packageId}: proposal total matches Stripe's one-time charge exactly`, () => {
    const input = validateProposalInput({
      leadId: 'L1', trade: 'plumber', painPoint: 'test', package: packageId,
    });
    const pkg = getPackage(packageId);

    const html = renderProposal({ input, businessName: 'Acme', signatureName: 'Alex' });
    const dueMatch = html.match(/Due to start<\/td><td class="amount">(\$[\d,]+)<\/td>/);
    assert.ok(dueMatch, 'proposal must show a due-today total');
    const shownDueCents = centsOf(dueMatch[1]);

    const stripeParams = buildCheckoutSessionParams({ leadId: 'L1', packageId });
    const oneTimeCents = stripeParams.line_items
      .filter(li => !li.price_data.recurring)
      .reduce((sum, li) => sum + li.price_data.unit_amount, 0);

    assert.equal(shownDueCents, oneTimeCents, 'proposal-shown due-today amount must equal Stripe\'s one-time line items');
    assert.equal(oneTimeCents, pkg.setupFeeUsd * 100);
  });
}

test('money path — custom line items are reflected identically in the proposal and in Stripe', () => {
  const input = validateProposalInput({
    leadId: 'L1', trade: 'plumber', painPoint: 'test', package: 'growth',
    customLineItems: [{ label: 'Rush setup', amountUsd: 75 }],
  });
  const html = renderProposal({ input, businessName: 'Acme', signatureName: 'Alex' });
  const dueMatch = html.match(/Due to start<\/td><td class="amount">(\$[\d,]+)<\/td>/);
  const shownDueCents = centsOf(dueMatch[1]);

  const stripeParams = buildCheckoutSessionParams({ leadId: 'L1', packageId: 'growth', customLineItems: input.customLineItems });
  const oneTimeCents = stripeParams.line_items
    .filter(li => !li.price_data.recurring)
    .reduce((sum, li) => sum + li.price_data.unit_amount, 0);

  assert.equal(shownDueCents, oneTimeCents);
  assert.equal(oneTimeCents, (497 + 75) * 100);
});

test('money path — an unknown package fails loud at every layer, never silently defaults to a price', () => {
  assert.throws(() => validateProposalInput({ leadId: 'L1', trade: 'plumber', painPoint: 'x', package: 'deluxe' }));
  assert.throws(() => getPackage('deluxe'));
  assert.throws(() => buildCheckoutSessionParams({ leadId: 'L1', packageId: 'deluxe' }));
});

test('money path — a missing package fails loud, never generates a $0 link', () => {
  assert.throws(() => validateProposalInput({ leadId: 'L1', trade: 'plumber', painPoint: 'x' }));
  assert.throws(() => buildCheckoutSessionParams({ leadId: 'L1', packageId: undefined }));
});
