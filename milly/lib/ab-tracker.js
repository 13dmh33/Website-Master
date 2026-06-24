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

// --- image design A/B testing (Phase 2) ---
// independent of caption variant — tests overlay opacity / NICHE_PALETTES design choices
// alternates weekly so each variant gets roughly equal exposure over time

// get which design variant should run this week (alternates A/B)
function getCurrentImageVariant() {
  const content = store.getLatestContent();
  if (!content || !content.imageVariantTracking) return 'A';
  return content.imageVariantTracking.lastVariant === 'A' ? 'B' : 'A';
}

// record which design variant was used this week
function recordImageVariant(weekOf, variant) {
  const content = store.getLatestContent();
  if (!content) return;
  content.imageVariantTracking = {
    ...(content.imageVariantTracking || {}),
    lastVariant: variant,
    [`week_${weekOf}`]: variant,
  };
  store.savePost(content);
}

// record which design variant performed better for a given week (called by analyst)
function recordImageVariantResult(weekOf, winnerVariant, engagementRateA, engagementRateB) {
  const content = store.getLatestContent();
  if (!content) return;
  if (!content.imageVariantTracking) content.imageVariantTracking = {};
  content.imageVariantTracking[`result_${weekOf}`] = {
    winner:          winnerVariant,
    engagementRateA,
    engagementRateB,
    recordedAt:      new Date().toISOString(),
  };
  store.savePost(content);
}

// get recent weeks of image design variant + engagement, for pattern comparison
function getImageVariantHistory(weeks = 4) {
  const recent = store.getRecentAnalytics(weeks);
  return recent
    .filter(a => a.imageVariant)
    .map(a => ({ weekOf: a.weekOf, variant: a.imageVariant, engagementRate: a.topPerformer?.engagementRate }));
}

module.exports = {
  getCurrentVariant, recordVariant, recordVariantResult, getVariantHistory,
  getCurrentImageVariant, recordImageVariant, recordImageVariantResult, getImageVariantHistory,
};
