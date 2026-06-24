'use strict';

// matching.js — shared client/opportunity topic-fit scoring
// Used by agents/pitcher.js (to rank pitches) and agents/reporter.js
// (to surface unpitched matches and flag clients with no open fit).

// Score how well a client's topics overlap with an opportunity's topics.
// Returns 0–1 (1 = strong match). Simple keyword overlap for now.
function matchScore(clientTopics, oppTopics) {
  if (!clientTopics?.length || !oppTopics?.length) return 0.3; // neutral if no data
  const clientSet = new Set(clientTopics.map(t => t.toLowerCase()));
  const oppSet    = new Set(oppTopics.map(t => t.toLowerCase()));
  let hits = 0;
  for (const t of oppSet) {
    if ([...clientSet].some(ct => ct.includes(t) || t.includes(ct))) hits++;
  }
  return hits / Math.max(oppSet.size, 1);
}

// Deprioritize (don't hard-exclude — visibility-building gigs can still be
// worth pitching) opportunities whose extracted fee ceiling falls below the
// client's stated floor. Most opportunities have no feeAmount data at all
// (snippet-only extraction), so this only fires when we actually know the fee.
function feeFitMultiplier(clientFee, oppFeeAmount) {
  if (!clientFee?.min || !oppFeeAmount?.max) return 1;
  return oppFeeAmount.max < clientFee.min ? 0.3 : 1;
}

// Rank open opportunities for a client by topic + fee fit. Mirrors the
// pitcher.js scoring exactly so reporter.js can show the same "what's next"
// list Dave will actually see drafts for.
function rankOpportunities(speaker, opportunities) {
  return opportunities
    .map(opp => ({ opp, score: matchScore(speaker.topics, opp.topics) * feeFitMultiplier(speaker.fee, opp.feeAmount) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  matchScore,
  feeFitMultiplier,
  rankOpportunities,
};
