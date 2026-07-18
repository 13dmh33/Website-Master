'use strict';
/**
 * Additive state.json fields for a sent proposal: proposalSentAt,
 * proposalPackage, proposalAmount, stripeSessionId. Matches casing already
 * in use on state.json's queue entries (camelCase precedent from
 * contact-scraper.js's preScrapeStatus/scrapedEmailAt — see prior
 * session's DISCOVERY.md). Never touches any existing field.
 *
 * Unlike Nora's conversation state (a different entity — an end
 * customer's ongoing chat, deliberately kept out of state.json per that
 * session's DISCOVERY.md), a sent proposal is directly about one of
 * Dave's own leads — exactly the entity state.json's queue already
 * tracks — so it belongs here.
 *
 * Fails loud if the leadId isn't found: a proposal that can't be recorded
 * against its lead is a real gap worth surfacing, not swallowing quietly,
 * given this is money-adjacent state.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', '..', '..', 'state.json');

/** statePath is overridable for tests — production callers always use the default. */
function recordProposalSent(leadId, { packageId, amountUsd, stripeSessionId }, statePath = STATE_PATH) {
  if (!fs.existsSync(statePath)) {
    throw new Error(`state.json not found at ${statePath}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const entry = state.queue.find(l => l.lead_id === leadId);
  if (!entry) {
    throw new Error(`recordProposalSent: no state.json queue entry found for lead "${leadId}"`);
  }

  entry.proposalSentAt = new Date().toISOString();
  entry.proposalPackage = packageId;
  entry.proposalAmount = amountUsd;
  entry.stripeSessionId = stripeSessionId || null;

  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return entry;
}

module.exports = { recordProposalSent, STATE_PATH };
