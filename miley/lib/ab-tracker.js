'use strict';

// A/B variant tracking for caption alternation (Enhancement B)
// tracks which caption variant (A or B) ran each week and how it performed
// stored as part of the content JSON — analyst reads it, generator reads it

const store = require('./store');

// get which variant should run this week (alternates A/B)
// returns 'A' or 'B'
function getCurrentVariant() {
  const content = store.getLatestContent();
  if (!content || !content.abTracking) return 'A';
  return content.abTracking.lastVariant === 'A' ? 'B' : 'A';
}

// record which variant was used this week
function recordVariant(weekOf, variant) {
  const content = store.getLatestContent();
  if (!content) return;
  content.abTracking = {
    ...(content.abTracking || {}),
    lastVariant: variant,
    [`week_${weekOf}`]: variant,
  };
  store.savePost(content);
}

// record which variant performed better (called by analyst)
function recordVariantResult(weekOf, winnerVariant, engagementRateA, engagementRateB) {
  const content = store.getLatestContent();
  if (!content) return;
  if (!content.abTracking) content.abTracking = {};
  content.abTracking[`result_${weekOf}`] = {
    winner:          winnerVariant,
    engagementRateA,
    engagementRateB,
    recordedAt:      new Date().toISOString(),
  };
  store.savePost(content);
}

// get the last 4 weeks of A/B results for pattern analysis
function getVariantHistory(weeks = 4) {
  const recent = store.getRecentAnalytics(weeks);
  return recent
    .filter(a => a.abVariant)
    .map(a => ({ weekOf: a.weekOf, variant: a.abVariant, engagementRate: a.topPerformer?.engagementRate }));
}

module.exports = { getCurrentVariant, recordVariant, recordVariantResult, getVariantHistory };
