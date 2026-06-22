'use strict';

// researcher — weekly brief agent (Techs4Tatas / Miley)
// runs Thursday (for the FOLLOWING week) via GitHub Actions, or manually.
//
// Reeve's version scanned SerpApi for conference "call for speakers" signals.
// Techs4Tatas has no equivalent (see inspiration-sources.json cfp_signal_note),
// so that branch is disabled. The researcher now assembles a lightweight,
// ZERO-API-COST brief from inspiration-sources.json: evergreen themes, the
// seasonal angle, and VERIFIED breast-cancer / women-in-trades data hooks that
// the generator can use for awareness posts.
//
// Live news scanning (BLS / ACS / NAWIC etc.) is a manual step in the weekly
// review (see docs/review-workflow.md) — read a source, paraphrase the idea,
// drop it into the brief. Never copy source text.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store   = require('../lib/store');
const planner = require('../lib/planner');

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
  const sources = store.getInspirationSources() || {};
  const week   = store.getCurrentWeek();
  const mode   = planner.getCampaignMode(now);

  console.log(`Research starting for week of ${weekOf} (mode: ${mode}, week #${week}).`);

  const brief = {
    weekOf,
    generatedAt:   new Date().toISOString(),
    researchMode:  'evergreen',           // local seeds only — no API spend
    campaignMode:  mode,
    week,
    seasonalAngle: pickSeasonalAngle(sources, now),
    themes:        (sources.evergreen_themes || []),
    facts:         pickVerifiedFacts(sources),
  };

  const filePath = store.saveBrief(brief);
  console.log(`Brief saved: themes ${brief.themes.length}, verified facts ${brief.facts.length}, seasonal angle "${brief.seasonalAngle}".`);
  console.log(`Brief saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Researcher failed: ${err.message}`);
  process.exit(1);
});
