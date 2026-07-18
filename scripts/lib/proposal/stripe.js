'use strict';
/**
 * Stripe Checkout Session generation — raw HTTPS to api.stripe.com,
 * matching this repo's established convention of avoiding SDK dependencies
 * even when one is installed (see pitcher.js's Twilio calls, enricher.js's
 * Apollo calls: both hand-roll the HTTPS request rather than pulling in
 * the vendor SDK).
 *
 * STATE-AUDIT.md finding: no STRIPE_SECRET_KEY exists in this
 * environment's .env.local, and the live checkout page still has
 * placeholder Payment Link URLs — Stripe is NOT live here despite the
 * session plan's assumption. buildCheckoutSessionParams() is pure and
 * fully testable without a key; createCheckoutSession() is the one
 * function that actually calls Stripe, and it fails loud immediately if
 * no key is provided — never silently skips or fakes a link.
 */

const https = require('https');
const { getPackage } = require('./packages');

/** Builds the line_items array for a package + any custom one-time line items. */
function buildLineItems(pkg, customLineItems = []) {
  const items = [
    {
      price_data: {
        currency: 'usd',
        product_data: { name: `${pkg.label} setup` },
        unit_amount: Math.round(pkg.setupFeeUsd * 100),
      },
      quantity: 1,
    },
    ...customLineItems.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.label },
        unit_amount: Math.round(item.amountUsd * 100),
      },
      quantity: 1,
    })),
  ];

  if (pkg.monthlyUsd > 0) {
    items.push({
      price_data: {
        currency: 'usd',
        product_data: { name: `${pkg.label} monthly plan` },
        unit_amount: Math.round(pkg.monthlyUsd * 100),
        recurring: { interval: 'month' },
      },
      quantity: 1,
    });
  }

  return items;
}

/**
 * Pure — builds the full Checkout Session request body. No network access,
 * no key required, fully unit-testable. mode is "subscription" whenever a
 * monthly component exists (Stripe subscription-mode sessions support
 * mixed one-time + recurring line items), otherwise "payment".
 */
function buildCheckoutSessionParams({ leadId, packageId, businessName, customLineItems, successUrl, cancelUrl }) {
  if (!leadId) throw new Error('buildCheckoutSessionParams requires leadId');
  const pkg = getPackage(packageId); // throws loud on an unknown/missing package
  const lineItems = buildLineItems(pkg, customLineItems);
  const mode = pkg.monthlyUsd > 0 ? 'subscription' : 'payment';

  return {
    mode,
    client_reference_id: leadId,
    line_items: lineItems,
    success_url: successUrl || 'https://trevoadvisors.com/proposal/thank-you',
    cancel_url: cancelUrl || 'https://trevoadvisors.com/proposal/',
    metadata: { leadId, package: pkg.id, businessName: businessName || '' },
  };
}

/** Flattens a nested object into Stripe's bracket-notation form-encoded params. */
function toFormParams(obj, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(obj)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          pairs.push(...toFormParams(item, `${paramKey}[${i}]`));
        } else {
          pairs.push([`${paramKey}[${i}]`, String(item)]);
        }
      });
    } else if (typeof value === 'object') {
      pairs.push(...toFormParams(value, paramKey));
    } else {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

/**
 * Creates a real Stripe Checkout Session. Fails loud if apiKey is missing —
 * this is the one function in the module that touches the network.
 */
function createCheckoutSession(params, apiKey) {
  if (!apiKey) {
    return Promise.reject(new Error(
      'STRIPE_SECRET_KEY not set — cannot generate a live payment link. ' +
      'See STATE-AUDIT.md: this environment has no Stripe key configured.'
    ));
  }

  const pairs = toFormParams(params);
  const body = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  const options = {
    hostname: 'api.stripe.com',
    path: '/v1/checkout/sessions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          reject(new Error(`Stripe returned unparseable response: ${data.slice(0, 200)}`));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ id: parsed.id, url: parsed.url });
        } else {
          const msg = parsed?.error?.message || JSON.stringify(parsed).slice(0, 200);
          reject(new Error(`Stripe error ${res.statusCode}: ${msg}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { buildLineItems, buildCheckoutSessionParams, toFormParams, createCheckoutSession };
