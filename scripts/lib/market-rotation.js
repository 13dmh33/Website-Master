'use strict';
/**
 * Market rotation — picks the next (city, trade) target for an unattended
 * Scout run, so the daily pipeline never needs a human to choose a market.
 *
 * Strategy, per Dave's 2026-07-28 decision: exhaust Colorado first, rotating
 * trades within each metro. Four trades across ~20 metros is ~80 combinations
 * rather than ~20, which is the difference between days and months of runway
 * at 30 sends/day. HVAC is permanently excluded (conflict of interest).
 *
 * Completion is derived from what Scout actually wrote to disk — leads/ and
 * leads-web/ filenames are the ground truth — NOT from a hand-maintained list
 * that can drift. A combo counts as done once a lead file exists for it.
 *
 * Ordering is deliberate: metros are listed largest-first, and the picker walks
 * trades within a city before moving on. That front-loads the biggest yields
 * and keeps a single city's crawl load together.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEADS_DIRS = ['leads', 'leads-web'];

// HVAC deliberately absent — see root CLAUDE.md's conflict-of-interest rule.
const TRADES = ['plumber', 'electrician', 'handyman', 'roofer'];

// Colorado metros, largest first. Denver/Aurora/Colorado Springs appear even
// though some trades are already done there — the picker skips completed
// combos, so a partially-worked metro still yields its remaining trades.
const CO_CITIES = [
  'Denver, CO', 'Colorado Springs, CO', 'Aurora, CO', 'Fort Collins, CO',
  'Lakewood, CO', 'Thornton, CO', 'Arvada, CO', 'Westminster, CO',
  'Pueblo, CO', 'Greeley, CO', 'Centennial, CO', 'Boulder, CO',
  'Longmont, CO', 'Loveland, CO', 'Broomfield, CO', 'Grand Junction, CO',
  'Castle Rock, CO', 'Commerce City, CO', 'Parker, CO', 'Littleton, CO',
  'Northglenn, CO', 'Brighton, CO', 'Englewood, CO', 'Wheat Ridge, CO',
  'Golden, CO', 'Louisville, CO', 'Erie, CO', 'Windsor, CO',
];

/** "Colorado Springs, CO" -> "colorado-springs-co" (mirrors scout's slugify). */
function slugifyCity(city) {
  return String(city).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function comboKey(city, trade) {
  return `${slugifyCity(city)}-${String(trade).toLowerCase()}`;
}

/**
 * Every (city, trade) Scout has already produced a lead file for. Reads real
 * filenames so a market can never be silently re-scouted after a manual run.
 * Filenames look like: colorado-springs-co-plumber-2026-07-28-run1.json and
 * needs-email-colorado-springs-co-plumber-2026-07-28-run1.csv
 */
function completedCombos(root = ROOT) {
  const done = new Set();
  for (const dir of LEADS_DIRS) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      const m = f.replace(/^needs-email-/, '')
        .match(/^([a-z-]+?)-(plumber|electrician|handyman|roofer)-\d{4}-\d{2}-\d{2}/);
      if (m) done.add(`${m[1]}-${m[2]}`);
    }
  }
  return done;
}

/**
 * Next unworked (city, trade), walking trades within a city before advancing.
 * Returns null when the whole list is exhausted — the caller must treat that as
 * a real signal (time to open a new state), not as a silent no-op.
 */
function nextTarget({ cities = CO_CITIES, trades = TRADES, root = ROOT, done } = {}) {
  const completed = done || completedCombos(root);
  for (const city of cities) {
    for (const trade of trades) {
      if (!completed.has(comboKey(city, trade))) return { city, trade };
    }
  }
  return null;
}

/** Progress summary for logs and the daily report. */
function rotationStatus({ cities = CO_CITIES, trades = TRADES, root = ROOT } = {}) {
  const completed = completedCombos(root);
  const total = cities.length * trades.length;
  let doneCount = 0;
  for (const city of cities) {
    for (const trade of trades) {
      if (completed.has(comboKey(city, trade))) doneCount++;
    }
  }
  return { total, done: doneCount, remaining: total - doneCount };
}

module.exports = {
  TRADES, CO_CITIES,
  slugifyCity, comboKey, completedCombos, nextTarget, rotationStatus,
};
