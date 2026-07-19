'use strict';
/**
 * The opinionated core. A fixed rubric scores each candidate next-move by
 * two axes:
 *
 * - revenueProximity (0-10): how directly this moves an EXISTING lead
 *   already in the pipeline toward paid. 10 = directly closes/advances a
 *   lead already booked or approved. 0 = pure infrastructure with no
 *   traceable path to an existing lead.
 * - buildVolume (0-10): how much NEW code/surface area this adds. 0 = no
 *   code at all (a manual action or config change). 10 = a brand new
 *   subsystem.
 *
 * HARD RULE, not a preference: revenue proximity is weighted 3x build
 * volume's penalty. This is deliberate — Dave's documented risk is 20+
 * scripts and ~0 closed deals, and an auditor that always recommends more
 * code accelerates that exact trap. A manual, zero-build action that
 * directly advances existing approved leads will often outscore a new
 * feature, and that is the intended behavior, not a bug to tune away.
 */

const REVENUE_WEIGHT = 3;
const BUILD_PENALTY_WEIGHT = 1;

function scoreCandidate(candidate) {
  return candidate.revenueProximity * REVENUE_WEIGHT - candidate.buildVolume * BUILD_PENALTY_WEIGHT;
}

/**
 * Static, standing candidates — the accumulated backlog from the
 * standing action-items memory and prior sessions' CHECKPOINT.md
 * "what's next" sections. Kept here (not re-derived live) because these
 * are genuinely standing items, not something Merlin can freshly discover
 * from repo state alone — e.g. "enable IMAP in Zoho" has no code signal,
 * it's a fact Merlin was told and must not forget.
 */
function staticCandidates() {
  return [
    {
      id: 'enable_zoho_imap',
      label: 'Enable IMAP for dave@trevoadvisors.com in Zoho Mail settings',
      category: 'non_code_blocker',
      revenueProximity: 6,
      buildVolume: 0,
      effortHours: 0.1,
      why: 'Unblocks two already-finished pieces of code (Reply Agent, post-call-proposal Drafts delivery) with zero further engineering — pure unlock, no new surface area.',
    },
    {
      id: 'add_stripe_key',
      label: 'Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs',
      category: 'non_code_blocker',
      revenueProximity: 8,
      buildVolume: 0,
      effortHours: 0.25,
      why: 'The post-call-proposal pipeline is fully built and tested end to end except for this — a real key turns a finished feature into revenue capability with zero code changes.',
    },
    {
      id: 'merge_nora_and_funnel_metrics',
      label: 'Decide on and execute a merge plan for feature/nora-multichannel-config and feature/funnel-metrics',
      category: 'code_build',
      revenueProximity: 3,
      buildVolume: 2,
      effortHours: 1,
      why: 'Both are complete and tested but invisible to every other branch until merged — low revenue proximity on its own (no lead moves), but unblocks future sessions cheaply.',
    },
    {
      id: 'nora_remediation',
      label: 'Fix the 9 defects found in the Nora adversarial audit before any real contractor uses it live',
      category: 'code_build',
      revenueProximity: 2,
      buildVolume: 5,
      effortHours: 3,
      why: 'Safety-critical (Nora can escalate on the first missed call or go silently dark per customer) but zero current lead moves toward paid until Nora has a live customer — build volume without near-term revenue.',
    },
    {
      id: 'fix_poller_email_reply_gap',
      label: 'Wire reply-classifier.js into poller.js so email replies write "replied" into state.json like SMS already does',
      category: 'code_build',
      revenueProximity: 4,
      buildVolume: 3,
      effortHours: 1.5,
      why: 'Fixes a measurement gap, not a sales gap — improves report accuracy but does not by itself move any lead closer to paid.',
    },
    {
      id: 'revert_elevated_daily_limits',
      label: 'Revert checker-config.json / diagnoser-config.json daily_limit back to 30 (currently elevated)',
      category: 'data_hygiene',
      revenueProximity: 2,
      buildVolume: 0,
      effortHours: 0.05,
      why: 'A one-line config fix, not a build — trivial effort, low but nonzero integrity value.',
    },
    {
      id: 'dmarc_tighten',
      label: 'Tighten DMARC to p=quarantine once clean report cycles confirm it is safe',
      category: 'data_hygiene',
      revenueProximity: 1,
      buildVolume: 0,
      effortHours: 0.25,
      why: 'Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.',
    },
  ];
}

/**
 * Dynamic candidates derived from live pipeline state — these can only be
 * generated after a real Merlin run, since they depend on current numbers
 * (backlog depth, elevated limits actually being elevated right now, etc).
 */
function dynamicCandidates({ pipelineSnapshot }) {
  const candidates = [];
  const { sendActivity, funnel } = pipelineSnapshot;

  if (sendActivity && sendActivity.backlogAtChecked > 0) {
    const highBacklog = sendActivity.backlogAtChecked >= 100;
    candidates.push({
      id: 'clear_send_backlog',
      label: `Clear the ${sendActivity.backlogAtChecked}-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing`,
      category: 'manual_sales_action',
      revenueProximity: 9,
      buildVolume: 0,
      effortHours: 0.1,
      why: `${sendActivity.backlogAtChecked} leads are already Checker-approved and waiting — every one of them is closer to paid than any lead that doesn't exist yet. At the current ${sendActivity.dailyLimit}/day cap this takes ${sendActivity.daysToClearBacklogAtCurrentCap} days; zero new code required either way.${highBacklog ? ' This is currently the single largest lever available.' : ''}`,
    });
  }

  if (funnel && funnel.biggestDropoff && funnel.biggestDropoff.lost > 0) {
    const d = funnel.biggestDropoff;
    candidates.push({
      id: 'investigate_biggest_dropoff',
      label: `Investigate the ${d.from} -> ${d.to} drop-off (${d.lost} leads lost, ${d.conversionPct}% conversion) before building anything new`,
      category: 'manual_sales_action',
      revenueProximity: 7,
      buildVolume: 0,
      effortHours: 0.5,
      why: `This is the single biggest measured leak in the funnel. Understanding why (capacity limit vs. genuine drop-off vs. measurement artifact — see the pipeline snapshot's integrity flags) is higher-value than building new lead sources on top of a leaky funnel.`,
    });
  }

  return candidates;
}

/** Ranks all candidates by score, descending. Ties broken by lower buildVolume (prefer the cheaper win). */
function rankCandidates(candidates) {
  return [...candidates]
    .map(c => ({ ...c, score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score || a.buildVolume - b.buildVolume);
}

function buildRanking({ pipelineSnapshot }) {
  const all = [...staticCandidates(), ...dynamicCandidates({ pipelineSnapshot })];
  const ranked = rankCandidates(all);
  const top = ranked[0] || null;

  return {
    ranked,
    recommendation: top,
    recommendationIsDontBuild: top ? top.buildVolume === 0 : false,
    rubric: { revenueWeight: REVENUE_WEIGHT, buildPenaltyWeight: BUILD_PENALTY_WEIGHT },
  };
}

module.exports = { scoreCandidate, staticCandidates, dynamicCandidates, rankCandidates, buildRanking, REVENUE_WEIGHT, BUILD_PENALTY_WEIGHT };
