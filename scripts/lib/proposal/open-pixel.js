'use strict';
/**
 * Pure helpers for the proposal open-tracking pixel — separated from
 * netlify/functions/proposal-open.js so the logic is unit-testable without
 * a Netlify runtime.
 */

// Standard 1x1 transparent GIF.
const TRANSPARENT_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

/** Extracts and validates the leadId from query params. Returns null (not throw) — a pixel must never fail loud. */
function extractLeadId(queryParams) {
  const leadId = queryParams && queryParams.leadId;
  if (typeof leadId !== 'string' || leadId.trim().length === 0) return null;
  return leadId;
}

/** Builds the Sheet row for a logged open. */
function buildOpenRow(leadId, userAgent) {
  return [new Date().toISOString(), leadId, userAgent || ''];
}

const OPENS_TAB = 'ProposalOpens';
const OPENS_HEADER = ['timestamp', 'leadId', 'userAgent'];

module.exports = { TRANSPARENT_GIF_BASE64, extractLeadId, buildOpenRow, OPENS_TAB, OPENS_HEADER };
