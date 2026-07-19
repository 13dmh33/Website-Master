/**
 * Meta DM responder (Instagram/Facebook) — STUB ONLY. Not built this session.
 *
 * Scope: P2. Blocked on Meta business-messaging permissions / app review.
 * See channels/meta_dm/adapter.js and the session scope doc for context.
 *
 * When built, this file's job is the same as channels/sms/responder.js:
 * format core's decision into a Meta Send API payload and deliver it
 * through lib/dispatch.js's dispatchOutbound(), gated by a new
 * META_DM_LIVE check (already reserved in lib/gates.js).
 */

'use strict';

module.exports = {};
