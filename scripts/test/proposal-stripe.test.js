'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLineItems, buildCheckoutSessionParams, toFormParams, createCheckoutSession,
} = require('../lib/proposal/stripe');
const { getPackage } = require('../lib/proposal/packages');

test('buildLineItems — starter (no monthly) produces exactly one line item', () => {
  const items = buildLineItems(getPackage('starter'));
  assert.equal(items.length, 1);
  assert.equal(items[0].price_data.unit_amount, 10000); // $100 in cents
  assert.equal(items[0].price_data.recurring, undefined);
});

test('buildLineItems — growth produces a setup line item and a recurring monthly line item', () => {
  const items = buildLineItems(getPackage('growth'));
  assert.equal(items.length, 2);
  assert.equal(items[0].price_data.unit_amount, 49700); // $497
  assert.equal(items[1].price_data.unit_amount, 14700); // $147
  assert.equal(items[1].price_data.recurring.interval, 'month');
});

test('buildLineItems — custom line items are appended as one-time charges', () => {
  const items = buildLineItems(getPackage('pro'), [{ label: 'Rush setup', amountUsd: 50 }]);
  assert.equal(items.length, 3); // setup + custom + monthly
  const custom = items.find(i => i.price_data.product_data.name === 'Rush setup');
  assert.ok(custom);
  assert.equal(custom.price_data.unit_amount, 5000);
  assert.equal(custom.price_data.recurring, undefined);
});

test('buildCheckoutSessionParams — mode is "payment" for starter, "subscription" for growth/pro', () => {
  const starter = buildCheckoutSessionParams({ leadId: 'L1', packageId: 'starter' });
  assert.equal(starter.mode, 'payment');
  const growth = buildCheckoutSessionParams({ leadId: 'L1', packageId: 'growth' });
  assert.equal(growth.mode, 'subscription');
});

test('buildCheckoutSessionParams — throws loud on an unknown package, never builds a bad session', () => {
  assert.throws(() => buildCheckoutSessionParams({ leadId: 'L1', packageId: 'enterprise' }), /Unknown package/);
});

test('buildCheckoutSessionParams — throws loud on a missing leadId', () => {
  assert.throws(() => buildCheckoutSessionParams({ packageId: 'starter' }), /requires leadId/);
});

test('buildCheckoutSessionParams — carries leadId through as client_reference_id and metadata', () => {
  const params = buildCheckoutSessionParams({ leadId: 'lead-42', packageId: 'growth', businessName: 'Acme Plumbing' });
  assert.equal(params.client_reference_id, 'lead-42');
  assert.equal(params.metadata.leadId, 'lead-42');
  assert.equal(params.metadata.businessName, 'Acme Plumbing');
});

test('toFormParams — flattens nested objects and arrays into Stripe bracket notation', () => {
  const pairs = toFormParams({ mode: 'payment', line_items: [{ price_data: { currency: 'usd' }, quantity: 1 }] });
  const asMap = Object.fromEntries(pairs);
  assert.equal(asMap['mode'], 'payment');
  assert.equal(asMap['line_items[0][price_data][currency]'], 'usd');
  assert.equal(asMap['line_items[0][quantity]'], '1');
});

test('createCheckoutSession — fails loud with no network call when apiKey is missing', async () => {
  const params = buildCheckoutSessionParams({ leadId: 'L1', packageId: 'starter' });
  await assert.rejects(
    () => createCheckoutSession(params, undefined),
    /STRIPE_SECRET_KEY not set/
  );
});

test('createCheckoutSession — fails loud with an empty-string apiKey too', async () => {
  const params = buildCheckoutSessionParams({ leadId: 'L1', packageId: 'starter' });
  await assert.rejects(
    () => createCheckoutSession(params, ''),
    /STRIPE_SECRET_KEY not set/
  );
});
