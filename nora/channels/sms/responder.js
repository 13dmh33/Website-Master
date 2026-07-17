/**
 * SMS responder — formats core's decision into an outbound SMS and sends it
 * through the draft-or-send gate. Gated by SMS_LIVE (in addition to the
 * NORA_LIVE master gate) — off by default, per the session's safety rules.
 */

'use strict';

const { dispatchOutbound } = require('../../lib/dispatch');
const { sendSms } = require('../../lib/twilio');

async function respond({ config, decision, toIdentity, twilioCreds }) {
  return dispatchOutbound({
    customerId: config.customerId,
    channel: 'sms',
    payload: { to: toIdentity, body: decision.replyText },
    sendFn: (payload) => sendSms({ ...twilioCreds, to: payload.to, body: payload.body }),
  });
}

module.exports = { respond };
