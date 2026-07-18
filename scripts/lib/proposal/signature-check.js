'use strict';
/**
 * Signature env-var check — Tier 2.4. Confirms SIGNATURE_NAME is set to
 * something real before any proposal generates, so a proposal never goes
 * out unsigned or with an obvious placeholder value.
 */

const PLACEHOLDER_VALUES = new Set([
  'your name', 'todo', 'tbd', 'name', 'signature_name', 'founder_name', 'placeholder',
]);

/**
 * Returns { ok: true } or { ok: false, reason }. Never throws — callers
 * decide what to do with a failed check (generate-proposal.js exits loud).
 */
function checkSignatureConfigured(signatureName) {
  if (typeof signatureName !== 'string' || signatureName.trim().length === 0) {
    return { ok: false, reason: 'SIGNATURE_NAME is not set.' };
  }
  if (PLACEHOLDER_VALUES.has(signatureName.trim().toLowerCase())) {
    return { ok: false, reason: `SIGNATURE_NAME is set to an obvious placeholder value ("${signatureName}").` };
  }
  return { ok: true };
}

module.exports = { checkSignatureConfigured, PLACEHOLDER_VALUES };
