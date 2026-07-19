/**
 * Missed-call adapter — the first channel, and the one Nora is actually
 * sold on today (see templates.json's e6 copy). Built fresh this session:
 * no prior implementation existed to wrap (DISCOVERY.md).
 *
 * Twilio calls a voice status callback URL when a call to the customer's
 * number ends. CallStatus of no-answer/busy/failed means nobody picked up —
 * that's the trigger for a text-back. A CallStatus of "completed" means a
 * human answered; this adapter does nothing for it (only channel-specific
 * translation lives here — no decision logic).
 */

'use strict';

const { makeNormalizedMessage } = require('../../lib/normalize');

const MISSED_STATUSES = ['no-answer', 'busy', 'failed'];

/**
 * Converts a Twilio voice status callback body into a normalized message,
 * or null if this callback isn't actually a missed call.
 * conversationId is the caller's phone number — the same thread a follow-up
 * SMS reply from that number will land in via the sms channel.
 */
function twilioCallbackToNormalizedMessage(customerId, params) {
  if (!MISSED_STATUSES.includes(params.CallStatus)) {
    return null;
  }
  return makeNormalizedMessage({
    customerId,
    channel: 'missed_call',
    fromIdentity: params.From,
    text: '',
    conversationId: params.From,
  });
}

module.exports = { twilioCallbackToNormalizedMessage, MISSED_STATUSES };
