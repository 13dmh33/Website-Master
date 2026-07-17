'use strict';
/**
 * lead-files — shared read-only loaders for leads/*.json and
 * leads-web/*.json, factored out so scripts/apollo-hit-rate.js and
 * scripts/generate-funnel-dashboard.js don't duplicate the same scan.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEADS_DIR = path.join(ROOT, 'leads');
const LEADS_WEB_DIR = path.join(ROOT, 'leads-web');

function readJsonArraySafe(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** no-website mode — genuinely phone-only leads. */
function loadPhoneOnlyLeads() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  const files = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));
  return files.flatMap(f => readJsonArraySafe(path.join(LEADS_DIR, f)));
}

/**
 * has-website mode — a real site exists, Apollo was used to find an email.
 * Scans every leads-web/*.json (both needs-email-*.json misses and the
 * post-hit {basename}.json files) — see enricher.js's
 * moveHasWebsiteLeadToAuditorReady for why a lead only ever lands in one
 * of those, never both.
 */
function loadHasWebsiteLeads() {
  if (!fs.existsSync(LEADS_WEB_DIR)) return [];
  const files = fs.readdirSync(LEADS_WEB_DIR).filter(f => f.endsWith('.json'));
  return files.flatMap(f => readJsonArraySafe(path.join(LEADS_WEB_DIR, f)));
}

module.exports = { loadPhoneOnlyLeads, loadHasWebsiteLeads, LEADS_DIR, LEADS_WEB_DIR };
