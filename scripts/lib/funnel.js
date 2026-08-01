'use strict';
/**
 * funnel — pure computation over state.json's real stage vocabulary
 * (see DISCOVERY.md for how this was derived from actual code, not
 * assumed). Read-only: takes a queue array in, returns numbers out.
 *
 * Two complementary views, because the exit statuses (closed/unsubscribed)
 * don't cleanly fit a single unambiguous "reached stage N" model:
 *
 * - rawCounts: how many leads are CURRENTLY sitting at each status right
 *   now. Zero interpretation required — this is exactly what's in the data.
 * - cumulativeReached / transitions: "how many leads got at least this
 *   far," built by ranking every status and anchoring the exit statuses
 *   (closed/unsubscribed/unresponsive) to the rank they're known to have
 *   reached — see ANCHOR_RANK below and DISCOVERY.md for why each anchor
 *   was chosen. This is where "biggest drop-off" comes from.
 *
 * mockup_pending/mockup_ready are reported separately, not as a funnel
 * stage — Builder only picks the top 5 leads/day out of `checked` (see
 * root CLAUDE.md's orchestration rules), so most leads skip it entirely;
 * treating it as a required gate would misstate the checked -> sent
 * conversion for the ~99% of leads that never go through Builder.
 */

// Rank order for the real, linear part of the funnel — every step here is
// a genuine prerequisite of the next (Pitcher only sends checker_approved
// briefs; drip.js only advances d1 -> d1b -> d1c -> d2 in order; a lead
// can't be "replied" without first being "sent").
const FUNNEL_ORDER = [
  'scouted', 'diagnosed', 'checked', 'sent',
  'drip_d1_sent', 'drip_d1b_sent', 'drip_d1c_sent', 'drip_d2_sent',
  'replied', 'hot',
];

const RANK = Object.fromEntries(FUNNEL_ORDER.map((s, i) => [s, i]));

// Where an exit status is anchored in the rank sequence, per DISCOVERY.md:
// - closed: every observed closed_reason in real data was a pre-send
//   data-quality rejection (wrong state/city, bad GBP match, placeholder
//   email) — anchored at the start (rank of "scouted") as the conservative
//   floor, since the status field alone can't say exactly when each one
//   exited.
// - unsubscribed: requires having received at least the initial send to
//   reply STOP to — anchored at "sent". Can't tell how far into drip a
//   given unsubscribe happened; this is a known precision limit, not a bug.
// - unresponsive: drip.js only sets this after the full d1/d1b/d1c/d2
//   sequence is exhausted with no reply — anchored at "drip_d2_sent".
const ANCHOR_RANK = {
  closed: RANK.scouted,
  unsubscribed: RANK.sent,
  unresponsive: RANK.drip_d2_sent,
};

function rankOf(status) {
  if (status in RANK) return RANK[status];
  if (status in ANCHOR_RANK) return ANCHOR_RANK[status];
  return null; // unrecognized status (e.g. mockup_pending/ready) — excluded from ranked funnel
}

function computeRawCounts(queue) {
  const counts = {};
  for (const entry of queue) {
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  }
  return counts;
}

/** Count of leads whose current status ranks at or beyond each funnel stage. */
function computeCumulativeReached(queue) {
  const reached = Object.fromEntries(FUNNEL_ORDER.map(s => [s, 0]));
  for (const entry of queue) {
    const rank = rankOf(entry.status);
    if (rank === null) continue;
    for (let i = 0; i <= rank; i++) {
      reached[FUNNEL_ORDER[i]]++;
    }
  }
  return reached;
}

/** Per-adjacent-stage transitions: count in, count reaching next, conversion %, absolute lost. */
function computeTransitions(cumulativeReached) {
  const transitions = [];
  for (let i = 0; i < FUNNEL_ORDER.length - 1; i++) {
    const from = FUNNEL_ORDER[i];
    const to = FUNNEL_ORDER[i + 1];
    const countFrom = cumulativeReached[from];
    const countTo = cumulativeReached[to];
    const lost = countFrom - countTo;
    const conversionPct = countFrom > 0 ? parseFloat(((countTo / countFrom) * 100).toFixed(1)) : null;
    transitions.push({ from, to, countFrom, countTo, lost, conversionPct });
  }
  return transitions;
}

/** The transition losing the most leads in absolute count — "the number that tells you what to fix next." */
function biggestDropoff(transitions) {
  const withVolume = transitions.filter(t => t.countFrom > 0);
  if (withVolume.length === 0) return null;
  return withVolume.reduce((worst, t) => (t.lost > worst.lost ? t : worst), withVolume[0]);
}

/** The transition with the worst conversion RATE (may differ from biggest absolute loss on low-volume stages). */
function worstConversionRate(transitions) {
  const withVolume = transitions.filter(t => t.countFrom > 0 && t.conversionPct !== null);
  if (withVolume.length === 0) return null;
  return withVolume.reduce((worst, t) => (t.conversionPct < worst.conversionPct ? t : worst), withVolume[0]);
}

/**
 * Decompose a backlog stage into what can actually move versus what is
 * structurally stuck. Pure: takes the queue plus a lead_id -> brief map,
 * returns numbers.
 *
 * Why this exists. The ranked funnel above measures status transitions only,
 * so a stage's raw count silently treats every lead in it as convertible.
 * On 2026-07-31 that made "checked -> sent" read as 510 leads lost at 29.6%
 * conversion — the largest number in the report, investigated repeatedly as
 * if it were a conversion problem. It is not. Of those 510:
 *
 *   208  had no brief file at all, so Pitcher has nothing to read or send
 *   242  were channel 'sms', and SMS has never sent once in this pipeline's
 *        history (Twilio A2P 10DLC still unapproved — sms_sent_this_month
 *        has been 0 every month)
 *    36  were email but not yet checker_approved
 *    24  were email AND approved — the only ones that could send
 *
 * So 4.7% of that "backlog" was actionable, and the real constraint is
 * supply of email-capable approved leads, not send capacity: the daily cap
 * is 30 and the prior day sent 27, meaning the entire true backlog is under
 * one day of capacity. Reporting the raw count invites the wrong fix
 * (raise throughput) for the actual problem (find email addresses).
 */
function computeActionableBacklog(queue, briefsById, { stage = 'checked' } = {}) {
  const atStage = (queue || []).filter(l => l && l.status === stage);
  const get = (id) => (briefsById instanceof Map ? briefsById.get(id) : (briefsById || {})[id]);

  let noBrief = 0, sendable = 0, awaitingApproval = 0;
  const blockedByChannel = {};

  for (const lead of atStage) {
    const brief = get(lead.lead_id);
    if (!brief) { noBrief++; continue; }
    // A channel that has never delivered is not a slow lane, it is a closed
    // one — count it as blocked rather than pending regardless of approval.
    const channel = brief.channel || 'unknown';
    if (channel !== 'email') {
      blockedByChannel[channel] = (blockedByChannel[channel] || 0) + 1;
      continue;
    }
    if (brief.checker_approved) sendable++;
    else awaitingApproval++;
  }

  const blocked = Object.values(blockedByChannel).reduce((a, b) => a + b, 0);
  const total = atStage.length;
  return {
    stage,
    total,
    sendable,
    awaitingApproval,
    noBrief,
    blockedByChannel,
    blocked,
    actionablePct: total > 0 ? Math.round((sendable / total) * 1000) / 10 : null,
  };
}

function computeFunnel(queue) {
  const rawCounts = computeRawCounts(queue);
  const cumulativeReached = computeCumulativeReached(queue);
  const transitions = computeTransitions(cumulativeReached);
  return {
    rawCounts,
    cumulativeReached,
    transitions,
    biggestDropoff: biggestDropoff(transitions),
    worstConversionRate: worstConversionRate(transitions),
    mockupInProduction: (rawCounts.mockup_pending || 0) + (rawCounts.mockup_ready || 0),
    closedCount: rawCounts.closed || 0,
    unmeasured: {
      opened: 'no email-open tracking exists anywhere in the pipeline — this stage cannot be measured (see DISCOVERY.md)',
      booked: 'no signal for an actual won deal exists yet — "hot" only means a booking-slots reply was auto-sent, not that a call was booked (see DISCOVERY.md)',
      closedMeansWon: 'every observed "closed" lead was a data-quality rejection, not a sale — do not read closedCount as deals won',
    },
  };
}

module.exports = {
  FUNNEL_ORDER, RANK, ANCHOR_RANK,
  computeRawCounts, computeCumulativeReached, computeTransitions,
  biggestDropoff, worstConversionRate, computeFunnel,
  computeActionableBacklog,
};
