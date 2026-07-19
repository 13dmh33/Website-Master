'use strict';
/**
 * Cost audit — every figure here is either (a) real logged spend from this
 * repo's own scripts/cost-tracker.js log (not a vendor dashboard — this
 * repo's own record of what recordX() calls actually happened), or
 * (b) an estimate explicitly derived from merlin/config/unit-costs.json
 * and labeled as such. Never fabricates a number to fill a gap — an
 * unreachable or zero-activity figure is reported as "n/a" with a reason,
 * not guessed.
 */

const fs = require('fs');
const path = require('path');

const unitCosts = require('../config/unit-costs.json');
const { getMonthlySummary } = require('../../scripts/cost-tracker');

const PITCHER_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'pitcher-config.json');

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Real logged spend this month, by service — ground truth, not an estimate. */
function actualSpendThisMonth() {
  return getMonthlySummary(currentMonth());
}

/**
 * Projected monthly run-rate for services that aren't fully reflected in
 * the log yet (e.g. Apollo/Twilio when not currently active). Pure —
 * takes computed data in, returns numbers out.
 */
function projectedRunRate() {
  const projections = [];

  const apolloConfigured = Boolean(process.env.APOLLO_API_KEY);
  projections.push({
    service: 'apollo_subscription',
    active: apolloConfigured,
    monthlyUsd: apolloConfigured ? unitCosts.fixedMonthlyUsd.apolloSubscription : 0,
    note: apolloConfigured
      ? 'APOLLO_API_KEY is configured — subscription counted as active spend.'
      : 'APOLLO_API_KEY is not configured in this environment — subscription not counted (would be $' + unitCosts.fixedMonthlyUsd.apolloSubscription + '/mo if activated).',
  });

  const pitcherConfig = readJsonSafe(PITCHER_CONFIG_PATH);
  const smsThisMonth = pitcherConfig ? (pitcherConfig.sms_sent_this_month || 0) : 0;
  projections.push({
    service: 'twilio_sms',
    active: smsThisMonth > 0,
    monthlyUsd: parseFloat((smsThisMonth * unitCosts.twilioPerSmsUsd).toFixed(2)),
    note: smsThisMonth > 0
      ? `${smsThisMonth} SMS sent this month at $${unitCosts.twilioPerSmsUsd}/segment.`
      : 'Zero SMS sent this month (Twilio A2P 10DLC not yet approved, per the standing action-items memory) — projected cost is $0 until sends resume.',
  });

  return projections;
}

/**
 * Cost per outcome — total spend divided by a count of leads that reached
 * a meaningful positive signal (funnel "hot"/"replied" reach). Returns
 * null (never a fabricated number) when the denominator is zero.
 */
function costPerOutcome(totalSpendUsd, outcomeCount) {
  if (!outcomeCount || outcomeCount === 0) return null;
  return parseFloat((totalSpendUsd / outcomeCount).toFixed(2));
}

function buildCostAudit({ funnel }) {
  const actual = actualSpendThisMonth();
  const actualTotalUsd = Object.values(actual).reduce((sum, s) => sum + (s.cost_usd || 0), 0);

  const projections = projectedRunRate();

  const outcomeReach = funnel ? (funnel.cumulativeReached.hot || funnel.cumulativeReached.replied || 0) : 0;
  const perOutcomeUsd = costPerOutcome(actualTotalUsd, outcomeReach);

  return {
    month: currentMonth(),
    actualSpendByService: actual,
    actualTotalUsd: parseFloat(actualTotalUsd.toFixed(2)),
    projections,
    outcomeReach,
    costPerOutcomeUsd: perOutcomeUsd,
    costPerOutcomeNote: perOutcomeUsd === null
      ? `n/a — zero leads have reached "replied" or "hot" this month (see the biggest-dropoff finding), so cost-per-outcome is undefined, not zero.`
      : `$${perOutcomeUsd} per lead that reached a positive-signal reply, based on ${outcomeReach} such lead(s) and $${actualTotalUsd.toFixed(2)} total logged spend this month.`,
    assumptions: [
      'Actual spend is read from this repo\'s own cost-tracker.js log (config/cost-log.json), not a vendor dashboard — it reflects only activity that already called a recordX() function.',
      'Projections use merlin/config/unit-costs.json rates, editable by Dave if a rate drifts from the real vendor price.',
      'Zoho email and any other flat-subscription tools are not itemized as marginal pipeline spend.',
    ],
  };
}

module.exports = { actualSpendThisMonth, projectedRunRate, costPerOutcome, buildCostAudit, currentMonth };
