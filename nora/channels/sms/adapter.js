/**
 * SMS adapter — inbound two-way texting on the same Twilio number as
 * missed-call. Pairs naturally with missed-call: a customer who gets the
 * text-back typically replies here, continuing the same conversation
 * (conversationId is the sender's phone number, same key missed_call uses).
 *
 * Live-gated behind SMS_LIVE (see lib/gates.js) — that gate controls Nora's
 * own outbound replies, not whether this adapter can receive/log inbound
 * texts, which always happens so nothing is lost while the gate is closed.
 */

'use strict';

const { makeNormalizedMessage } = require('../../lib/normalize');

/** Converts a Twilio inbound-SMS webhook body into a normalized message. */
function twilioSmsToNormalizedMessage(customerId, params) {
  return makeNormalizedMessage({
    customerId,
    channel: 'sms',
    fromIdentity: params.From,
    text: (params.Body || '').trim(),
    conversationId: params.From,
  });
}

module.exports = { twilioSmsToNormalizedMessage };
