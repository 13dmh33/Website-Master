/**
 * Safety gates — nothing in Nora sends or books autonomously unless
 * explicitly enabled. A gate being off must never break the pipeline: it
 * routes output to draft/log instead of erroring. See lib/dispatch.js for
 * the draft-or-send wrapper that uses these.
 *
 * NORA_LIVE       — master gate. Off = every channel is draft/log only.
 * SMS_LIVE        — additional per-channel gate for two-way SMS.
 * CHAT_LIVE       — stub for the future web_chat channel (not built this session).
 * META_DM_LIVE    — stub for the future meta_dm channel (not built this session).
 *
 * missed_call has no additional per-channel gate beyond NORA_LIVE — the
 * scope doc lists SMS_LIVE plus CHAT_LIVE/META_DM_LIVE stubs only.
 */

'use strict';

const CHANNEL_GATE_ENV = {
  missed_call: null, // gated by NORA_LIVE only
  sms: 'SMS_LIVE',
  web_chat: 'CHAT_LIVE',
  meta_dm: 'META_DM_LIVE',
};

function isTrue(envVar) {
  return process.env[envVar] === 'true' || process.env[envVar] === '1';
}

function isNoraLive() {
  return isTrue('NORA_LIVE');
}

function isChannelGateOpen(channel) {
  const envVar = CHANNEL_GATE_ENV[channel];
  if (envVar === undefined) {
    throw new Error(`gates.isChannelGateOpen: unknown channel "${channel}"`);
  }
  if (envVar === null) return true; // no extra gate for this channel
  return isTrue(envVar);
}

/** True only when the master gate AND the channel's own gate (if any) are both on. */
function isLive(channel) {
  return isNoraLive() && isChannelGateOpen(channel);
}

module.exports = { isNoraLive, isChannelGateOpen, isLive, CHANNEL_GATE_ENV };
