'use strict';

// glossary.js — trade term injection for Techs4Tatas
// picks 2-3 terms per week and formats them for Claude prompt injection.
// terms live in templates/trades-glossary.json, organized by trade category
// (plumbing / electrical / hvac / construction).

const fs   = require('fs');
const path = require('path');

const GLOSSARY_PATH = path.join(__dirname, '..', 'templates', 'trades-glossary.json');

function loadGlossary() {
  if (!fs.existsSync(GLOSSARY_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// flatten the categorized structure into a single list of { term, meaning, trade }
function flattenTerms(glossary) {
  if (!glossary || !glossary.categories) return [];
  const flat = [];
  for (const [trade, terms] of Object.entries(glossary.categories)) {
    for (const t of terms) flat.push({ ...t, trade });
  }
  return flat;
}

// return N random terms as "term: meaning" strings (what generator-prompts expects).
// optional `trade` filter (plumbing | electrical | hvac | construction).
function getWeeklyTerms(count, trade = null) {
  const glossary = loadGlossary();
  const all = flattenTerms(glossary);
  if (!all.length) return [];

  const n = count || glossary.inject_per_week || 3;
  const pool = trade ? all.filter(t => t.trade === trade) : all;
  const source = pool.length ? pool : all;

  const shuffled = [...source].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map(t => `${t.term}: ${t.meaning}`);
}

// available trade categories
function getTrades() {
  const glossary = loadGlossary();
  return glossary && glossary.categories ? Object.keys(glossary.categories) : [];
}

module.exports = { getWeeklyTerms, getTrades, flattenTerms };
