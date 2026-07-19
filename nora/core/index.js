/**
 * Nora core — channel- and offering-agnostic. Consumes a normalized message
 * plus a customer config and decides: qualify / route / book / escalate.
 *
 * `decide()` is a pure function (message, config, conversation) -> { conversation, decision }
 * with no I/O, so it's directly unit-testable. `processMessage()` is the
 * thin stateful wrapper that adapters call — it does the state read/write
 * around decide().
 *
 * Brand rules apply to every customer-facing string produced here: no
 * emojis, sentence case, no founder name, no "business days" language
 * (use concrete timeframes), "AI agent" never "bot".
 */

'use strict';

const { getConversation, saveConversation } = require('../lib/state');
const { isWithinBusinessHours } = require('./business-hours');
const { resolveOffering } = require('./routing');
const { detectTriggers, buildEscalationReplyText } = require('./escalate');

function afterHoursNotice() {
  return "We're closed right now, but I've got your message and someone will follow up as soon as we reopen.";
}

function buildBookingReplyText(offering, afterHours, afterHoursBehavior) {
  const base = `Got it — that's everything I need for ${offering.label.toLowerCase()}. I'll get this over to the team to lock in a time.`;
  if (afterHours && afterHoursBehavior === 'capture_and_promise') {
    return `${base} We're closed right now, so expect a follow-up as soon as we reopen to confirm the exact time.`;
  }
  return `${base} Expect a confirmation shortly.`;
}

/**
 * Pure decision function. No filesystem or network access.
 * Returns { conversation: <updated conversation record, not yet saved>, decision }.
 */
function decide(message, config, conversation) {
  const updated = { ...conversation };
  const isVeryFirstTurn = !conversation.channel;
  updated.channel = message.channel;
  if (message.channel === 'missed_call') {
    updated.missedCallCount = (conversation.missedCallCount || 0) + 1;
  }

  // Escalation is checked every turn, before routing/qualify, and short-circuits them.
  if (updated.status !== 'escalated') {
    const triggers = detectTriggers(config, message, updated);
    if (triggers.length > 0) {
      updated.status = 'escalated';
      updated.escalated = true;
      updated.escalationTriggers = triggers;
      return {
        conversation: updated,
        decision: { action: 'escalate', replyText: buildEscalationReplyText(), triggers },
      };
    }
  }

  const afterHours = !isWithinBusinessHours(config.businessHours, message.timestamp);

  const routing = resolveOffering(config, message, updated);
  if (!routing.resolved) {
    updated.offeringId = null;
    updated.routingResolved = false;
    let replyText = routing.question;
    if (afterHours && config.afterHoursBehavior === 'capture_and_promise' && isVeryFirstTurn) {
      replyText = `${afterHoursNotice()} ${replyText}`;
    }
    return { conversation: updated, decision: { action: 'ask_routing_question', replyText } };
  }
  updated.offeringId = routing.offeringId;
  updated.routingResolved = true;

  const offering = config.offerings.find(o => o.id === updated.offeringId);
  if (!offering) {
    throw new Error(`Nora core: resolved offeringId "${updated.offeringId}" not found in config for customer "${config.customerId}"`);
  }

  // If a question was already pending, this inbound message answers it.
  if (updated.pendingQuestion) {
    updated.answers = [...(updated.answers || []), {
      question: updated.pendingQuestion, answer: message.text, at: message.timestamp,
    }];
    updated.qualifyIndex = updated.answers.length;
    updated.pendingQuestion = null;
  }

  if (updated.qualifyIndex < offering.qualifyQs.length) {
    const nextQuestion = offering.qualifyQs[updated.qualifyIndex];
    updated.pendingQuestion = nextQuestion;
    let replyText = nextQuestion;
    if (afterHours && config.afterHoursBehavior === 'capture_and_promise' && isVeryFirstTurn) {
      replyText = `${afterHoursNotice()} ${replyText}`;
    }
    return { conversation: updated, decision: { action: 'ask_qualify_question', replyText } };
  }

  // All qualifying questions answered. No live Cal.com booking call exists this
  // session (out of scope) — this always produces a draft-style confirmation
  // referencing the offering's calendarId, never an autonomous booking.
  updated.status = 'qualified';
  return {
    conversation: updated,
    decision: {
      action: 'qualified_confirm_booking',
      replyText: buildBookingReplyText(offering, afterHours, config.afterHoursBehavior),
      offeringId: offering.id,
      calendarId: offering.calendarId,
      bookingType: offering.bookingType,
    },
  };
}

/** Stateful wrapper: reads conversation state, calls decide(), persists the result. */
function processMessage(message, config) {
  const conversation = getConversation(message.customerId, message.conversationId);
  const { conversation: updated, decision } = decide(message, config, conversation);
  const saved = saveConversation(updated);
  return { decision, conversation: saved };
}

module.exports = { decide, processMessage, afterHoursNotice, buildBookingReplyText };
