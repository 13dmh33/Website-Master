'use strict';
/**
 * Brand-standard checks — pure, testable functions. Two categories:
 *
 * - checkCustomerFacingText(text): what a customer actually sees
 *   (rendered HTML/email body) — no emojis, no standalone "bot", no
 *   "business day(s)" language.
 * - checkSourceForHardcodedName(text): source code that GENERATES
 *   customer-facing copy — no hardcoded founder name as a literal string.
 *   This is deliberately NOT run against rendered output: a real proposal
 *   is meant to be signed with a real human name (Tier 1's "signed
 *   personally via env var" — the rule is against hardcoding it in the
 *   template, not against a dynamic signature appearing in the result).
 */

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const BOT_PATTERN = /\bbot\b/i;
const BUSINESS_DAYS_PATTERN = /business\s+days?/i;
const FOUNDER_NAME_PATTERNS = [/\bDave\b/, /David\s+Hettinger/i];

function checkCustomerFacingText(text, label = 'text') {
  const findings = [];
  if (EMOJI_PATTERN.test(text)) findings.push(`${label}: contains an emoji`);
  if (BOT_PATTERN.test(text)) findings.push(`${label}: contains "bot" — must say "AI agent"`);
  if (BUSINESS_DAYS_PATTERN.test(text)) findings.push(`${label}: contains "business day(s)" language`);
  return findings;
}

/**
 * Strips // line comments and /* block comments *\/ so architectural notes
 * ("Dave's sales prospects" explaining whose data a field holds) don't
 * false-positive — this check cares about literals that could leak into
 * generated customer-facing copy, not code comments about the business.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function checkSourceForHardcodedName(text, label = 'source') {
  const findings = [];
  const codeOnly = stripComments(text);
  for (const pattern of FOUNDER_NAME_PATTERNS) {
    if (pattern.test(codeOnly)) findings.push(`${label}: appears to hardcode the founder name (${pattern})`);
  }
  return findings;
}

module.exports = {
  checkCustomerFacingText, checkSourceForHardcodedName,
  EMOJI_PATTERN, BOT_PATTERN, BUSINESS_DAYS_PATTERN, FOUNDER_NAME_PATTERNS,
};
