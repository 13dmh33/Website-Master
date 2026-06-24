'use strict';

// cost-tracker.js — SerpApi spend cap for Reeve's conference-scout.js
// Mirrors the cost-cap pattern used by Trevo's scripts/scout.js (config/scout-config.json)

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'scout-config.json');

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function loadConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    config = {
      monthly_cap: 5.00,
      cost_per_search: 0.015,
      current_month: null,
      spent_this_month: 0,
      total_runs: 0,
      total_found: 0,
      total_saved: 0,
      last_run: null,
      auto_run: false,
    };
  }
  // Roll over spend tracking at the start of a new month
  const month = currentMonth();
  if (config.current_month !== month) {
    config.current_month = month;
    config.spent_this_month = 0;
  }
  return config;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Returns { ok: boolean, remaining: number, config }
function checkBudget() {
  const config = loadConfig();
  const remaining = config.monthly_cap - config.spent_this_month;
  return { ok: remaining >= config.cost_per_search, remaining, config };
}

// Record one search call against the budget. Returns the updated config.
function recordSearch(config) {
  config.spent_this_month = parseFloat((config.spent_this_month + config.cost_per_search).toFixed(6));
  saveConfig(config);
  return config;
}

function recordRunSummary(config, { found = 0, saved = 0 } = {}) {
  config.total_runs   = (config.total_runs || 0) + 1;
  config.total_found  = (config.total_found || 0) + found;
  config.total_saved  = (config.total_saved || 0) + saved;
  config.last_run     = new Date().toISOString();
  saveConfig(config);
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  checkBudget,
  recordSearch,
  recordRunSummary,
};
