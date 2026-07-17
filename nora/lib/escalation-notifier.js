/**
 * Escalation notification — tells the contractor (not the end customer)
 * that a conversation needs a person. Draft-or-notify only: this never
 * autonomously calls or texts the contractor for real until SMS_LIVE (the
 * notification rides the same SMS gate as any other outbound text) and
 * NORA_LIVE are both on. toEmail has no live send path this session (email
 * isn't one of the four built/scaffolded channels) — it always logs/drafts.
 */

'use strict';

const { dispatchOutbound, log } = require('./dispatch');
const { sendSms } = require('./twilio');

function buildNotificationText(config, message, triggers) {
  const triggerList = triggers.join(', ');
  return `Nora escalation for ${config.customerId}: a conversation with ${message.fromIdentity} needs a person (${triggerList}). Channel: ${message.channel}.`;
}

/**
 * notifyEscalation({ config, message, triggers, twilioCreds })
 * twilioCreds: { accountSid, authToken, from } — the Nora-managed sending
 * number for this deployment (dev/test uses the single-tenant env vars).
 */
async function notifyEscalation({ config, message, triggers, twilioCreds }) {
  const results = {};
  const text = buildNotificationText(config, message, triggers);

  if (config.escalation.toPhone) {
    results.phone = await dispatchOutbound({
      customerId: config.customerId,
      channel: 'sms',
      payload: { to: config.escalation.toPhone, body: text, purpose: 'escalation_notify' },
      sendFn: (payload) => sendSms({ ...twilioCreds, to: payload.to, body: payload.body }),
    });
  }

  if (config.escalation.toEmail) {
    // No live email channel exists in Nora this session — always logs, never sends.
    log(`Escalation email would go to ${config.escalation.toEmail} for customer=${config.customerId}: ${text}`);
    results.email = { mode: 'draft', ref: config.escalation.toEmail };
  }

  return results;
}

module.exports = { notifyEscalation, buildNotificationText };
