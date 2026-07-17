/**
 * Normalized inbound message shape — the only thing Nora core ever sees.
 *
 * { customerId, channel, fromIdentity, text, timestamp, conversationId }
 *
 * Adapters build this from whatever a channel actually sends (a Twilio SMS
 * webhook body, a missed-call status callback, eventually a web chat POST or
 * a Meta DM webhook). Core and responders never touch a channel-specific
 * payload shape directly.
 */

'use strict';

const { KNOWN_CHANNELS } = require('../config/schema');

/**
 * Builds and validates a normalized message. Throws on missing/invalid
 * required fields — adapters must not pass through malformed data.
 */
function makeNormalizedMessage({ customerId, channel, fromIdentity, text, timestamp, conversationId }) {
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('normalized message requires a non-empty customerId');
  }
  if (!KNOWN_CHANNELS.includes(channel)) {
    throw new Error(`normalized message has unknown channel "${channel}" (expected one of: ${KNOWN_CHANNELS.join(', ')})`);
  }
  if (typeof fromIdentity !== 'string' || fromIdentity.trim().length === 0) {
    throw new Error('normalized message requires a non-empty fromIdentity');
  }
  if (typeof text !== 'string') {
    throw new Error('normalized message requires text (use an empty string for a no-text event, e.g. a missed call)');
  }
  if (typeof conversationId !== 'string' || conversationId.trim().length === 0) {
    throw new Error('normalized message requires a non-empty conversationId');
  }

  return {
    customerId,
    channel,
    fromIdentity,
    text,
    timestamp: timestamp || new Date().toISOString(),
    conversationId,
  };
}

/** A missed call carries no text — this is the conventional placeholder core looks for. */
const MISSED_CALL_TEXT = '';

module.exports = { makeNormalizedMessage, MISSED_CALL_TEXT };
