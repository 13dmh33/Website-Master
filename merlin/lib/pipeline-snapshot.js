'use strict';
/**
 * Pipeline snapshot — funnel state, send activity vs cap, Apollo ROI, and
 * known data-integrity flags. Reuses scripts/lib/funnel.js and
 * scripts/lib/apollo-metrics.js directly (merged onto this branch from
 * feature/funnel-metrics — see STATE-AUDIT.md) rather than re-implementing
 * the same stage-ranking logic a second time.
 */

const fs = require('fs');
const path = require('path');

const { computeFunnel, computeActionableBacklog } = require('../../scripts/lib/funnel');
const { computeApolloMetrics } = require('../../scripts/lib/apollo-metrics');
const { loadPhoneOnlyLeads, loadHasWebsiteLeads } = require('../../scripts/lib/lead-files');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const PITCHER_CONFIG_PATH = path.join(ROOT, 'config', 'pitcher-config.json');
const CHECKER_CONFIG_PATH = path.join(ROOT, 'config', 'checker-config.json');
const DIAGNOSER_CONFIG_PATH = path.join(ROOT, 'config', 'diagnoser-config.json');
const POLLER_PATH = path.join(ROOT, 'scripts', 'poller.js');
const QUEUE_DIR = path.join(ROOT, 'queue');

const NORMAL_DAILY_LIMIT = 30; // documented normal value per root CLAUDE.md's action items

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** Known, standing data-integrity gaps — computed live where possible, static where not. */
function collectIntegrityFlags({ pitcherConfig, checkerConfig, diagnoserConfig, apollo, pollerSrc }) {
  const flags = [];

  // Only flag the poller email-reply gap if it is actually still present.
  // The fix wires reply-classifier.js into poller.js; once merged, re-raising
  // this as an open gap is the self-contradiction Task 10d exists to prevent
  // (Merlin's own repo-facts see it fixed, so its integrity list must too).
  if (pollerSrc === null || !/reply-classifier/.test(pollerSrc)) {
    flags.push({
      id: 'poller_email_reply_gap',
      severity: 'medium',
      message: 'poller.js does not write "replied" into state.json for email replies the way webhook.js does for SMS — email replies are undercounted in this snapshot\'s funnel numbers.',
    });
  }

  flags.push({
    id: 'closed_not_won',
    severity: 'high',
    message: 'status: "closed" in state.json has never meant a won deal in this pipeline\'s history — every observed occurrence has been a data-quality rejection. Do not read a closed count as revenue.',
  });

  if (checkerConfig && checkerConfig.daily_limit > NORMAL_DAILY_LIMIT) {
    flags.push({
      id: 'checker_limit_elevated',
      severity: 'low',
      message: `checker-config.json daily_limit is ${checkerConfig.daily_limit}, above the documented normal value of ${NORMAL_DAILY_LIMIT} — confirm this elevated cap is still intentional.`,
    });
  }
  if (diagnoserConfig && diagnoserConfig.daily_limit > NORMAL_DAILY_LIMIT) {
    flags.push({
      id: 'diagnoser_limit_elevated',
      severity: 'low',
      message: `diagnoser-config.json daily_limit is ${diagnoserConfig.daily_limit}, above the documented normal value of ${NORMAL_DAILY_LIMIT} — confirm this elevated cap is still intentional.`,
    });
  }

  if (apollo.phoneOnly.attempted === 0) {
    flags.push({
      id: 'apollo_unmeasured',
      severity: 'low',
      message: 'Apollo hit-rate instrumentation exists but has never been exercised — Enricher has not been run for real since it shipped. Apollo ROI figures below are not yet meaningful.',
    });
  }

  if (!pitcherConfig) {
    flags.push({
      id: 'pitcher_config_missing',
      severity: 'medium',
      message: 'config/pitcher-config.json not found or unreadable — send-activity figures below are unavailable.',
    });
  }

  return flags;
}

/**
 * Task 10c — stalled stages. Given the previous run's cumulativeReached, find
 * funnel stages whose reached-count did NOT change since last run AND that
 * still have leads waiting to advance past them. A frozen stage (nobody moved)
 * is a distinct signal from the biggest one-time drop-off — it usually means
 * an operational step isn't running rather than a conversion problem.
 */
function computeStalledStages(funnel, previousFunnel) {
  if (!previousFunnel || !previousFunnel.cumulativeReached) return [];
  const cur = funnel.cumulativeReached;
  const prev = previousFunnel.cumulativeReached;
  const order = Object.keys(cur);
  const stalls = [];
  for (let i = 0; i < order.length - 1; i++) {
    const stage = order[i];
    const next = order[i + 1];
    const reached = cur[stage] || 0;
    const advanced = cur[next] || 0;
    const waiting = reached - advanced;
    const unchangedNext = (cur[next] || 0) === (prev[next] || 0);
    // Frozen: same number has advanced past this stage as last run, yet leads wait.
    if (reached > 0 && waiting > 0 && unchangedNext && (cur[stage] || 0) === (prev[stage] || 0)) {
      stalls.push({ stage, reached, waiting });
    }
  }
  // Report the worst first (most leads stuck), cap at the top 3 to keep the report focused.
  return stalls.sort((a, b) => b.waiting - a.waiting).slice(0, 3);
}

/**
 * Load every queue brief as lead_id -> brief. Briefs carry the two fields
 * state.json does not — channel and checker_approved — which is what turns a
 * raw stage count into a count of leads that can actually move.
 */
function loadBriefs(dir = QUEUE_DIR) {
  const briefs = {};
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return briefs; }
  for (const name of names) {
    if (!name.endsWith('-brief.json')) continue;
    const brief = readJsonSafe(path.join(dir, name), null);
    if (brief && brief.lead_id) briefs[brief.lead_id] = brief;
  }
  return briefs;
}

function collectPipelineSnapshot({ previousFunnel = null } = {}) {
  const state = readJsonSafe(STATE_PATH, { queue: [] });
  const funnel = computeFunnel(state.queue);
  funnel.stalledStages = computeStalledStages(funnel, previousFunnel);

  const actionableBacklog = computeActionableBacklog(state.queue, loadBriefs());

  const apollo = {
    phoneOnly: computeApolloMetrics(loadPhoneOnlyLeads()),
    hasWebsite: computeApolloMetrics(loadHasWebsiteLeads()),
  };

  const pitcherConfig = readJsonSafe(PITCHER_CONFIG_PATH, null);
  const checkerConfig = readJsonSafe(CHECKER_CONFIG_PATH, null);
  const diagnoserConfig = readJsonSafe(DIAGNOSER_CONFIG_PATH, null);

  const sendActivity = pitcherConfig ? {
    dailyLimit: pitcherConfig.daily_limit,
    sentToday: pitcherConfig.sent_today,
    sentThisMonth: pitcherConfig.sent_this_month,
    totalSent: pitcherConfig.total_sent,
    backlogAtChecked: funnel.rawCounts.checked || 0,
    sendableAtChecked: actionableBacklog.sendable,
    // Days-to-clear must divide the SENDABLE backlog, not the raw stage count.
    // Dividing the raw count implied ~17 days of pending work on 2026-07-31
    // when only 24 leads could actually send — under one day at the cap — and
    // pointed at throughput as the fix when the real constraint is supply of
    // email-capable approved leads.
    daysToClearBacklogAtCurrentCap: pitcherConfig.daily_limit > 0
      ? Math.ceil(actionableBacklog.sendable / pitcherConfig.daily_limit)
      : null,
  } : null;

  const pollerSrc = readFileSafe(POLLER_PATH);
  const integrityFlags = collectIntegrityFlags({ pitcherConfig, checkerConfig, diagnoserConfig, apollo, pollerSrc });

  return { funnel, apollo, sendActivity, integrityFlags, actionableBacklog };
}

module.exports = {
  collectPipelineSnapshot, collectIntegrityFlags, computeStalledStages,
  loadBriefs, NORMAL_DAILY_LIMIT,
};
