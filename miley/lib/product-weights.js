'use strict';

// product-weights.js — dynamic product-rotation weighting (#9).
//
// lib/planner.js's nextProduct() used to round-robin the catalog with equal
// airtime for every product. This expands the rotation list so products with
// more UTM click-through (output/clicks/latest.json, the Analyst's sales
// signal) appear more often, while a floor weight keeps low-performing/new
// products from being starved entirely.
//
// No rolling-window history yet — weights are computed straight off the
// latest click snapshot. Dormant/no-op until output/clicks/latest.json has
// real data: with no click data, weightedCatalog() returns the catalog
// unchanged (today's exact round-robin behavior).

const store = require('./store');

const FLOOR_WEIGHT = 1;     // every product gets at least this much weight, even with zero clicks
const MAX_REPEATS  = 5;     // cap how many times the top product can repeat in the expanded rotation

// returns { [productKey]: weight } — floor + clicks, or null if no click data exists
function getWeights(catalog) {
  const clicks = store.getClickData();
  const byContent = clicks && clicks.by_content;
  if (!byContent || !Object.keys(byContent).length) return null;

  const weights = {};
  for (const key of catalog) weights[key] = FLOOR_WEIGHT + (byContent[key] || 0);
  return weights;
}

// expand `catalog` into a longer rotation list where higher-weight products
// appear proportionally more often (capped at MAX_REPEATS), preserving
// catalog order as the tiebreak so rotation stays deterministic week-to-week.
function weightedCatalog(catalog) {
  if (!catalog.length) return catalog;
  const weights = getWeights(catalog);
  if (!weights) return catalog; // no click data yet — unchanged round-robin

  const minWeight = Math.min(...Object.values(weights));
  const expanded = [];
  for (const key of catalog) {
    const repeats = Math.min(MAX_REPEATS, Math.max(1, Math.round(weights[key] / minWeight)));
    for (let i = 0; i < repeats; i++) expanded.push(key);
  }
  return expanded;
}

module.exports = { weightedCatalog, getWeights, FLOOR_WEIGHT, MAX_REPEATS };
