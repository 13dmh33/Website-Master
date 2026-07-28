'use strict';

// planner.js — resolves Molly's weekly posting plan for Trevo Advisors.
//
// Molly posts a fixed 4-post week (carousel/caption/trevo_found/reel on
// TUE/THU/SAT/SUN) rather than Miley's slot/campaign-mode system (base /
// september / october) — there's no seasonal cadence change here, so a
// literal port of Miley's planner.js doesn't fit. What DOES carry over is the
// same idea: centralize the week's rotation decisions in one place so
// researcher/generator/designer/scheduler agree on the same plan, instead of
// each one recomputing `Math.floor(Date.now() / week-ms)` independently.
//
// This module owns:
//   - which week number we're on (single definition, used everywhere)
//   - caption/reel niche rotation (wraps store.getWeekNiches())
//   - the trevo_found demo-vs-agent rotation + which item (moved here from
//     generator.js's inline DEMOS/AGENTS arrays)
//   - the reel visual-style rotation (card / kinetic_karaoke / kinetic_punch) —
//     new capability, mirroring Miley's reel_styles rotation
//   - calendar-driven angle context (lib/calendar.js) for the week

const store    = require('./store');
const calendar = require('./calendar');

const REEL_STYLES = ['card', 'kinetic_karaoke', 'kinetic_punch'];

const DEMOS = [
  { trade: 'plumbing',   url: 'trevoadvisors.com/demos/plumbing/',   features: ['Tap-to-call above the fold', 'Emergency service page', 'Google reviews live', 'Service area map', 'Trust badges — licensed & insured', 'Live in as little as two days'] },
  { trade: 'electrical', url: 'trevoadvisors.com/demos/electrical/', features: ['Tap-to-call above the fold', 'Panel upgrade service page', 'Google reviews live', 'Service area map', 'Trust badges — licensed & insured', 'Live in as little as two days'] },
  { trade: 'handyman',   url: 'trevoadvisors.com/demos/handyman/',   features: ['Tap-to-call above the fold', 'Service menu with photos', 'Google reviews live', 'Instant quote request form', 'Trust badges', 'Live in as little as two days'] },
];

const AGENTS = [
  { name: 'Nora',  tagline: 'AI lead follow-up agent',    url: 'trevoadvisors.com/start/', features: ['Texts new leads in under a minute', 'Follows up without you lifting a finger', 'Hands off hot leads with full context', 'Works while you\'re on the job', 'Pairs with any Trevo website'] },
  { name: 'Atlas', tagline: 'AI lead pipeline manager',   url: 'trevoadvisors.com/atlas/', features: ['Scores and sorts leads by close probability', 'Sends personalized follow-up sequences', 'Flags high-value jobs for you', 'Dashboard to see pipeline at a glance', 'Add-on to your Trevo site'] },
  { name: 'Argus', tagline: 'AI review responder',        url: 'trevoadvisors.com/argus/', features: ['Responds to every Google review automatically', 'Flags negative reviews for human review', 'Keeps your profile active for SEO', 'Sounds like you, not automated', 'Works on any Google Business Profile'] },
];

// single definition of "week number" — every rotation below derives from this
function getWeekNumber(date = new Date()) {
  return Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
}

// alternates demo weeks / agent weeks (even → agent, odd → demo — matches the
// pre-planner behavior in generator.js so existing rotation state doesn't jump)
function pickTrevoFound(weekNumber) {
  const useAgent = weekNumber % 2 === 0;
  return useAgent
    ? { kind: 'agent', item: AGENTS[weekNumber % AGENTS.length] }
    : { kind: 'demo',  item: DEMOS[weekNumber % DEMOS.length] };
}

function pickReelStyle(weekNumber) {
  return REEL_STYLES[((weekNumber % REEL_STYLES.length) + REEL_STYLES.length) % REEL_STYLES.length];
}

// Calendar entries can't override Molly's fixed format/day schedule the way
// they can in Miley's slot system, so every active entry — regardless of
// priority — becomes extra angle context for the generator to weave into
// whichever prompt fits, rather than swapping a post's format. Highest
// priority entry is called out separately as the week's primary calendar
// angle; the rest ride along as supplements.
function resolveCalendarContext(date) {
  const entries = calendar.getActiveEntries(date);
  if (!entries.length) return { primary: null, supplements: [] };
  const [primary, ...rest] = entries;
  return { primary, supplements: rest };
}

function buildWeekPlan(date = new Date()) {
  const weekNumber = getWeekNumber(date);
  const { caption: captionNiche, reel: reelNiche } = store.getWeekNiches();
  const trevoFound = pickTrevoFound(weekNumber);
  const reelStyle  = pickReelStyle(weekNumber);
  const calendarContext = resolveCalendarContext(date);

  return { weekNumber, captionNiche, reelNiche, trevoFound, reelStyle, calendarContext };
}

module.exports = {
  buildWeekPlan,
  getWeekNumber,
  pickTrevoFound,
  pickReelStyle,
  resolveCalendarContext,
  REEL_STYLES,
  DEMOS,
  AGENTS,
};
