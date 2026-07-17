/**
 * Missed-call responder — formats core's decision into an outbound text-back
 * and sends it through the draft-or-send gate (lib/dispatch.js). The
 * text-back itself is delivered over SMS transport, but is gated and logged
 * under the "missed_call" channel identity, matching enabledChannels
 * treating missed_call and sms as separate toggles.
 */

'use strict';

const { dispatchOutbound } = require('../../lib/dispatch');
const { sendSms } = require('../../lib/twilio');

/**
 * respond({ config, decision, toIdentity, twilioCreds })
 * Returns the dispatchOutbound result: { mode: 'live' | 'draft', ref }.
 */
async function respond({ config, decision, toIdentity, twilioCreds }) {
  return dispatchOutbound({
    customerId: config.customerId,
    channel: 'missed_call',
    payload: { to: toIdentity, body: decision.replyText },
    sendFn: (payload) => sendSms({ ...twilioCreds, to: payload.to, body: payload.body }),
  });
}

module.exports = { respond };
