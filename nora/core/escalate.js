/**
 * Escalation trigger detection — zero-cost keyword matching, no API calls,
 * matching the rest of this repo's convention (see scripts/reply-classifier.js).
 *
 * Only triggers a customer has opted into (config.escalation.triggers) ever
 * fire. "high_value" has no text signal available this session (would need
 * a deal-value estimate this build doesn't have) so it's declarable but
 * never auto-fires — documented, not silently ignored.
 */

'use strict';

const EMERGENCY_KEYWORDS = [
  'emergency', 'flooding', 'flood', 'burst pipe', 'gas smell', 'gas leak',
  'no heat', 'sparking', 'fire', 'sewage backup', 'urgent',
];

const ANGRY_KEYWORDS = [
  'furious', 'unacceptable', 'lawsuit', 'scam', 'rip off', 'ripoff',
  'terrible service', 'worst', 'angry', 'pissed',
];

const EXPLICIT_REQUEST_KEYWORDS = [
  'talk to a person', 'speak to someone', 'human please', 'real person',
  'talk to someone', 'speak with a manager', 'manager please',
];

/**
 * detectTriggers(config, message, conversation) -> array of trigger names
 * that fired this turn, restricted to ones declared in the customer's config.
 */
function detectTriggers(config, message, conversation) {
  const declared = new Set(config.escalation.triggers);
  const fired = [];
  const lower = (message.text || '').toLowerCase();

  if (declared.has('emergency') && EMERGENCY_KEYWORDS.some(k => lower.includes(k))) {
    fired.push('emergency');
  }
  if (declared.has('angry_customer') && ANGRY_KEYWORDS.some(k => lower.includes(k))) {
    fired.push('angry_customer');
  }
  if (declared.has('explicit_request') && EXPLICIT_REQUEST_KEYWORDS.some(k => lower.includes(k))) {
    fired.push('explicit_request');
  }
  if (declared.has('repeat_no_answer') && message.channel === 'missed_call' && (conversation.missedCallCount || 0) >= 1) {
    fired.push('repeat_no_answer');
  }
  // declared.has('high_value') intentionally never auto-fires — no signal for it yet.

  return fired;
}

/** Sentence-case, no emojis, no founder name, "AI agent" not "bot" — brand rules apply here too. */
function buildEscalationReplyText() {
  return "Thanks for the details. I'm an AI scheduling agent, and this needs a person's attention — connecting you with our team now, and someone will follow up shortly.";
}

module.exports = { detectTriggers, buildEscalationReplyText, EMERGENCY_KEYWORDS, ANGRY_KEYWORDS, EXPLICIT_REQUEST_KEYWORDS };
