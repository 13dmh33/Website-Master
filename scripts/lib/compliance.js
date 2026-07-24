'use strict';
/**
 * CAN-SPAM compliance footer — appended to every commercial email at send time
 * by pitcher.js and drip.js. Centralized on purpose: a single source of truth
 * means no template (present or future) can go out missing the legally-required
 * ad identification (#3), physical postal address (#4), and opt-out mechanism
 * (#5). The opt-out is a reply-based "stop", which reply-classifier.js already
 * classifies as `unsubscribed` and suppression.js already hard-gates — so the
 * mechanism the footer promises is real and honored, not a dead link.
 *
 * Pure except one file read at the edge; takes an injectable loader for tests.
 */

const fs = require('fs');
const path = require('path');

const COMPLIANCE_PATH = path.join(__dirname, '..', '..', 'config', 'compliance.json');

function loadCompliance(read = () => fs.readFileSync(COMPLIANCE_PATH, 'utf8')) {
  try { return JSON.parse(read()); } catch { return {}; }
}

/**
 * Which CAN-SPAM footer requirements are satisfied by the current config.
 * #3 ad_disclosure and #5 opt_out_line ship with defaults; #4 physical_address
 * must be supplied by Dave. Returns { compliant, missing: [ '#4 ...', ... ] }.
 */
function emailComplianceStatus(c = loadCompliance()) {
  const missing = [];
  if (!c.ad_disclosure || !c.ad_disclosure.trim()) missing.push('#3 ad identification (ad_disclosure)');
  if (!c.physical_address || !c.physical_address.trim()) missing.push('#4 physical postal address (physical_address)');
  if (!c.opt_out_line || !c.opt_out_line.trim()) missing.push('#5 opt-out mechanism (opt_out_line)');
  return { compliant: missing.length === 0, missing };
}

/** Builds the footer block. Address line is omitted only when blank (guard blocks the send in that case anyway). */
function buildFooter(c = loadCompliance()) {
  const lines = [];
  if (c.ad_disclosure && c.ad_disclosure.trim()) lines.push(c.ad_disclosure.trim());
  if (c.physical_address && c.physical_address.trim()) {
    lines.push(`${c.business_name ? c.business_name + ', ' : ''}${c.physical_address.trim()}`);
  }
  if (c.opt_out_line && c.opt_out_line.trim()) lines.push(c.opt_out_line.trim());
  return lines.join('\n');
}

/** Appends the footer beneath the email body, separated by a standard footer rule. */
function appendFooter(body, c = loadCompliance()) {
  const footer = buildFooter(c);
  if (!footer) return body;
  return `${body}\n\n--\n${footer}`;
}

/**
 * Send-path guard. Throws a clear, actionable error if the email is not fully
 * CAN-SPAM compliant, so no partial-compliance message can ever leave. Called
 * at the top of each email send. Fails safe: pitcher/drip wrap sends in
 * try/catch, so this surfaces as a per-lead error rather than crashing a run.
 */
function assertEmailCompliant(c = loadCompliance()) {
  const { compliant, missing } = emailComplianceStatus(c);
  if (!compliant) {
    throw new Error(
      `BLOCKED by CAN-SPAM compliance gate — email not sent. Missing: ${missing.join('; ')}. ` +
      `Fill it in config/compliance.json (see scripts/lib/compliance.js). Email sending stays blocked until then.`
    );
  }
}

module.exports = {
  loadCompliance, emailComplianceStatus, buildFooter, appendFooter, assertEmailCompliant, COMPLIANCE_PATH,
};
