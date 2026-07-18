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

const { computeFunnel } = require('../../scripts/lib/funnel');
const { computeApolloMetrics } = require('../../scripts/lib/apollo-metrics');
const { loadPhoneOnlyLeads, loadHasWebsiteLeads } = require('../../scripts/lib/lead-files');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const PITCHER_CONFIG_PATH = path.join(ROOT, 'config', 'pitcher-config.json');
const CHECKER_CONFIG_PATH = path.join(ROOT, 'config', 'checker-config.json');
const DIAGNOSER_CONFIG_PATH = path.join(ROOT, 'config', 'diagnoser-config.json');

const NORMAL_DAILY_LIMIT = 30; // documented normal value per root CLAUDE.md's action items

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

/** Known, standing data-integrity gaps — computed live where possible, static where not. */
function collectIntegrityFlags({ pitcherConfig, checkerConfig, diagnoserConfig, apollo }) {
  const flags = [];

  flags.push({
    id: 'poller_email_reply_gap',
    severity: 'medium',
    message: 'poller.js does not write "replied" into state.json for email replies the way webhook.js does for SMS — email replies are undercounted in this snapshot\'s funnel numbers.',
  });

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

function collectPipelineSnapshot() {
  const state = readJsonSafe(STATE_PATH, { queue: [] });
  const funnel = computeFunnel(state.queue);

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
    daysToClearBacklogAtCurrentCap: pitcherConfig.daily_limit > 0
      ? Math.ceil((funnel.rawCounts.checked || 0) / pitcherConfig.daily_limit)
      : null,
  } : null;

  const integrityFlags = collectIntegrityFlags({ pitcherConfig, checkerConfig, diagnoserConfig, apollo });

  return { funnel, apollo, sendActivity, integrityFlags };
}

module.exports = { collectPipelineSnapshot, collectIntegrityFlags, NORMAL_DAILY_LIMIT };
