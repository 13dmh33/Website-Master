'use strict';
/**
 * Ordering for the drip queue, extracted so it is testable without executing
 * drip.js (which sends real messages on require).
 *
 * Why it exists. drip.js built its due queue in readdirSync order and then
 * sliced it to daily_limit, so which leads got a follow-up was effectively
 * arbitrary — and one channel could take every slot. On 2026-07-31, 130
 * messages were due (58 email, 72 sms) and all 20 slots went to sms, a channel
 * that has never delivered a single message (Twilio A2P 10DLC still
 * unapproved). Every one of those sends would have failed, while 58
 * deliverable email follow-ups waited another day — the oldest already 22 days
 * past due and days from the 26-day dead_after_days sweep that would retire
 * them unanswered.
 *
 * Deliberately does NOT encode which channel is currently healthy. SMS becomes
 * deliverable the day A2P clears, and nothing here should need editing then.
 */

/**
 * @param {Array<{channel: string, daysOverdue?: number}>} queue
 * @returns {Array} same items, ordered:
 *   1. round-robin across channels, so no channel starves another
 *   2. most overdue first within each channel, so the daily budget goes to
 *      whatever is closest to aging out
 */
function orderDripQueue(queue) {
  const items = Array.isArray(queue) ? queue : [];
  const byChannel = new Map();
  for (const item of items) {
    const channel = (item && item.channel) || 'unknown';
    if (!byChannel.has(channel)) byChannel.set(channel, []);
    byChannel.get(channel).push(item);
  }
  for (const lane of byChannel.values()) {
    lane.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
  }

  const lanes = [...byChannel.values()];
  const ordered = [];
  const deepest = lanes.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < deepest; i++) {
    for (const lane of lanes) {
      if (i < lane.length) ordered.push(lane[i]);
    }
  }
  return ordered;
}

module.exports = { orderDripQueue };
