/**
 * Offering routing — for a multi-offering customer, work out which offering
 * a conversation is about. Single-offering customers never see a routing
 * question at all: there is nothing to disambiguate.
 */

'use strict';

function matchOfferingsFromText(offerings, text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return offerings.filter(o => {
    if (lower.includes(o.id.toLowerCase())) return true;
    if (lower.includes(o.label.toLowerCase())) return true;
    // Fall back to individual significant words from the label (e.g. "heating"
    // out of "Heating and cooling") so natural phrasing still resolves without
    // requiring the exact label string.
    const words = o.label.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    return words.some(w => lower.includes(w));
  });
}

function buildRoutingQuestion(offerings) {
  const labels = offerings.map(o => o.label.toLowerCase());
  if (labels.length === 2) {
    return `Are you calling about ${labels[0]} or ${labels[1]}?`;
  }
  const allButLast = labels.slice(0, -1).join(', ');
  const last = labels[labels.length - 1];
  return `Which service is this about — ${allButLast}, or ${last}?`;
}

/**
 * resolveOffering(config, message, conversation)
 * Returns { offeringId, question, resolved }.
 * - Single-offering customers: always resolved, no question, on the first call.
 * - Multi-offering, already resolved (conversation.routingResolved): pass through.
 * - Multi-offering, unresolved: try to infer from message text. Exactly one
 *   match resolves it. Zero or multiple matches asks exactly one routing
 *   question — the same one every turn until it resolves.
 */
function resolveOffering(config, message, conversation) {
  if (config.offerings.length === 1) {
    return { offeringId: config.offerings[0].id, question: null, resolved: true };
  }

  if (conversation.routingResolved && conversation.offeringId) {
    return { offeringId: conversation.offeringId, question: null, resolved: true };
  }

  const matched = matchOfferingsFromText(config.offerings, message.text);
  if (matched.length === 1) {
    return { offeringId: matched[0].id, question: null, resolved: true };
  }

  return { offeringId: null, question: buildRoutingQuestion(config.offerings), resolved: false };
}

module.exports = { resolveOffering, matchOfferingsFromText, buildRoutingQuestion };
