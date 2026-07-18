'use strict';
/**
 * Package definitions for post-call proposals — the three tiers named in
 * the session plan. Single source of truth: template rendering and Stripe
 * line-item generation both read from here, so a price never drifts
 * between what the proposal shows and what Stripe actually charges.
 */

const PACKAGES = {
  starter: {
    id: 'starter',
    label: 'Starter',
    description: 'A fast, professional website — done in under a week.',
    setupFeeUsd: 100,
    monthlyUsd: 0,
    features: [
      'Custom-built site for your trade',
      'Mobile-ready, fast-loading',
      'Live in under a week',
    ],
  },
  growth: {
    id: 'growth',
    label: 'Growth',
    description: 'Website plus Nora, the AI agent that answers missed calls and books jobs.',
    setupFeeUsd: 497,
    monthlyUsd: 147,
    features: [
      'Everything in Starter',
      'Nora answers missed calls and texts back automatically',
      'Qualifies the job and books the appointment',
    ],
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    description: 'Full agent suite — missed-call capture, review responses, and lead follow-up.',
    setupFeeUsd: 797,
    monthlyUsd: 197,
    features: [
      'Everything in Growth',
      'Argus responds to reviews automatically',
      'Atlas follows up with every lead until they book or say no',
    ],
  },
};

const PACKAGE_IDS = Object.keys(PACKAGES);

function getPackage(id) {
  const pkg = PACKAGES[id];
  if (!pkg) {
    throw new Error(`Unknown package "${id}" — expected one of: ${PACKAGE_IDS.join(', ')}`);
  }
  return pkg;
}

module.exports = { PACKAGES, PACKAGE_IDS, getPackage };
