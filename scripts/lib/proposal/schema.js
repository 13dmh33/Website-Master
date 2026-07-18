'use strict';
/**
 * Proposal input contract — the minimal structured input a completed call
 * produces. No call-notes source exists on this branch (Nora isn't merged
 * here — see STATE-AUDIT.md), so this is the documented fallback: a small
 * JSON file per lead under proposals/inputs/<leadId>.json.
 *
 * Fails loud on anything malformed — same philosophy as
 * nora/config/schema.js from the prior session: no silent defaulting on a
 * money-adjacent input.
 */

const { PACKAGE_IDS } = require('./packages');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function fail(leadId, message) {
  throw new Error(`Invalid proposal input${leadId ? ` (${leadId})` : ''}: ${message}`);
}

function validateCustomLineItems(items, leadId) {
  if (items === undefined) return;
  if (!Array.isArray(items)) fail(leadId, 'customLineItems must be an array if present');
  items.forEach((item, i) => {
    if (!item || typeof item !== 'object') fail(leadId, `customLineItems[${i}] must be an object`);
    if (!isNonEmptyString(item.label)) fail(leadId, `customLineItems[${i}].label is required`);
    if (typeof item.amountUsd !== 'number' || !Number.isFinite(item.amountUsd) || item.amountUsd < 0) {
      fail(leadId, `customLineItems[${i}].amountUsd must be a non-negative number`);
    }
  });
}

/**
 * Validates a proposal input object. Throws on any malformed field.
 * Returns the same object (not a copy) on success.
 */
function validateProposalInput(input) {
  if (!input || typeof input !== 'object') fail(null, 'input must be an object');
  const leadId = isNonEmptyString(input.leadId) ? input.leadId : null;

  if (!isNonEmptyString(input.leadId)) fail(leadId, 'leadId is required and must be a non-empty string');
  if (!isNonEmptyString(input.trade)) fail(leadId, 'trade is required and must be a non-empty string');
  if (!isNonEmptyString(input.painPoint)) fail(leadId, 'painPoint is required and must be a non-empty string');

  if (!isNonEmptyString(input.package) || !PACKAGE_IDS.includes(input.package)) {
    fail(leadId, `package must be one of: ${PACKAGE_IDS.join(', ')} (got "${input.package}")`);
  }

  if (input.offering !== undefined && !isNonEmptyString(input.offering)) {
    fail(leadId, 'offering must be a non-empty string if present');
  }
  if (input.personalNote !== undefined && typeof input.personalNote !== 'string') {
    fail(leadId, 'personalNote must be a string if present');
  }

  validateCustomLineItems(input.customLineItems, leadId);

  return input;
}

module.exports = { validateProposalInput };
