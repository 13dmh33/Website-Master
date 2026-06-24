'use strict';

// researcher — weekly brief agent (Techs4Tatas / Miley)
// runs Thursday (for the FOLLOWING week) via GitHub Actions, or manually.
//
// Reeve's version scanned SerpApi for conference "call for speakers" signals.
// Techs4Tatas has no equivalent (see inspiration-sources.json cfp_signal_note),
// so that branch is disabled. The researcher assembles a ZERO-API-COST brief
// from inspiration-sources.json: evergreen themes, the seasonal angle, and
// VERIFIED breast-cancer / women-in-trades data hooks for awareness posts.
//
// Live data refresh: it also pulls fresh RSS headlines (free, no key) from the
// brand's two beats via lib/sources.js, keyword-filtered and on-brand. These
// are paraphrasable ANGLES only — the Generator rewrites them in Riley's voice
// (never copy source text). Fails silently offline → brief still ships with the
// static themes + verified facts. Opt out with DISABLE_LIVE_RESEARCH=1.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store   = require('../lib/store');
const planner = require('../lib/planner');
const sources = require('../lib/sources');

// Monday of the current week as YYYY-MM-DD
function weekStartDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

// pick the seasonal angle whose window matches the current month
function pickSeasonalAngle(sources, date) {
  const angles = (sources && sources.seasonal_angles) || [];
  const month = date.getMonth() + 1;
  const windowMatch = {
    'Early March': month === 3,
    'Spring':      month >= 3 && month <= 5,
    'Summer':      month >= 6 && month <= 8,
    'September':   month === 9,
    'October':     month === 10,
    'November-December': month === 11 || month === 12,
  };
  const matched = angles.find(a => windowMatch[a.window]);
  const yearRound = angles.find(a => a.window === 'Year-round');
  return (matched || yearRound || { angle: 'Everyday trade pride + humor' }).angle;
}

// VERIFIED facts only — the data_hooks the generator may cite (in its own words)
function pickVerifiedFacts(sources) {
  const hooks = (sources && sources.data_hooks) || [];
  return hooks
    .filter(h => /verified/i.test(h.note || ''))
    .map(h => ({ claim: h.claim, source: h.source }));
}

async function main() {
  const weekOf = weekStartDate();
  const now    = new Date();
  const insp   = store.getInspirationSources() || {};
  const week   = store.getCurrentWeek();
  const mode   = planner.getCampaignMode(now);
  const plan   = planner.buildWeekPlan(now, week);

  console.log(`Research starting for week of ${weekOf} (mode: ${mode}, week #${week}).`);
  if (plan.calendarAngles && plan.calendarAngles.length) {
    console.log(`Calendar supplements this week: ${plan.calendarAngles.length}.`);
  }

  // live data refresh — free RSS, fails silently offline (no spend, no key)
  let live = { women_in_trades: [], breast_cancer: [] };
  if (process.env.DISABLE_LIVE_RESEARCH === '1') {
    console.log('Live research disabled (DISABLE_LIVE_RESEARCH=1) — using static seeds only.');
  } else {
    console.log('Fetching live headlines (women in trades + breast cancer)...');
    try {
      live = await sources.fetchLiveHeadlines({ perBeat: 4 });
    } catch {
      console.log('Live fetch unavailable — continuing with static seeds.');
    }
  }
  const liveCount = live.women_in_trades.length + live.breast_cancer.length;

  const brief = {
    weekOf,
    generatedAt:   new Date().toISOString(),
    researchMode:  liveCount ? 'hybrid' : 'evergreen', // hybrid = static seeds + fresh RSS angles
    campaignMode:  mode,
    week,
    seasonalAngle: pickSeasonalAngle(insp, now),
    themes:        (insp.evergreen_themes || []),
    facts:         pickVerifiedFacts(insp),
    liveHeadlines: live,                  // paraphrasable angles only — never copy verbatim
    calendarAngles: plan.calendarAngles || [], // supplement-mode calendar.json matches for this week
  };

  const filePath = store.saveBrief(brief);
  console.log(`Brief saved: themes ${brief.themes.length}, verified facts ${brief.facts.length}, live headlines ${liveCount}, mode ${brief.researchMode}.`);
  console.log(`Brief saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Researcher failed: ${err.message}`);
  process.exit(1);
});
