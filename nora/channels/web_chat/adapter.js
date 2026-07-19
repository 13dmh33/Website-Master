/**
 * Web chat adapter — STUB ONLY. Not built this session.
 *
 * Scope: P1, next session. Nothing external blocks it — likely the fastest
 * second live channel to ship once picked up. See the session scope doc
 * ("Nora multi-channel + multi-offering refactor") for full context.
 *
 * When built, this file's job is the same as channels/sms/adapter.js:
 * translate whatever the web chat widget POSTs into a normalized message
 * via lib/normalize.js's makeNormalizedMessage(), with channel: 'web_chat'.
 * Core and responders require zero changes to support it — that's the
 * point of this architecture.
 */

'use strict';

module.exports = {};
