'use strict';

// A/B variant tracking for caption alternation
// tracks which caption variant (A or B) ran each week

const store = require('./store');

function getCurrentVariant() {
  const content = store.getLatestContent();
  if (!content || !content.abTracking) return 'A';
  return content.abTracking.lastVariant === 'A' ? 'B' : 'A';
}

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

function recordVariantResult(weekOf, winnerVariant, engagementRateA, engagementRateB) {
  const content = store.getLatestContent();
  if (!content) return;
  if (!content.abTracking) content.abTracking = {};
  content.abTracking[`result_${weekOf}`] = {
    winner: winnerVariant, engagementRateA, engagementRateB,
    recordedAt: new Date().toISOString(),
  };
  store.savePost(content);
}

function getVariantHistory(weeks = 4) {
  const recent = store.getRecentAnalytics(weeks);
  return recent
    .filter(a => a.abVariant)
    .map(a => ({ weekOf: a.weekOf, variant: a.abVariant, engagementRate: a.topPerformer?.engagementRate }));
}

module.exports = { getCurrentVariant, recordVariant, recordVariantResult, getVariantHistory };
