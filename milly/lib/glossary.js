'use strict';

// glossary.js — speaking industry term injection
// picks 2-3 terms per week and formats them for Claude prompt injection
// terms live in templates/speaking-glossary.json

const fs   = require('fs');
const path = require('path');

const GLOSSARY_PATH = path.join(__dirname, '..', 'templates', 'speaking-glossary.json');

function loadGlossary() {
  if (!fs.existsSync(GLOSSARY_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(GLOSSARY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// return N random terms, optionally filtered by niche
function getWeeklyTerms(count = 3, niche = null) {
  const glossary = loadGlossary();
  if (!glossary || !glossary.terms?.length) return [];

  const pool = niche
    ? glossary.terms.filter(t => t.niche === niche || t.hook_potential === 'high')
    : glossary.terms;

  // shuffle and return first N
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// format terms for injection into a Claude prompt
function formatForPrompt(terms) {
  if (!terms || !terms.length) return '';
  const lines = terms.map(t =>
    `- ${t.term}: ${t.definition} | Content angle: ${t.content_angle}`
  );
  return `Speaking industry insider terms to weave in naturally (use 1-2 max, don't over-explain them):\n${lines.join('\n')}`;
}

// get a random high-potential term for a given niche — used by researcher
// to seed angle ideas from industry vocabulary
function getAngleSeedTerms(niche, count = 2) {
  const glossary = loadGlossary();
  if (!glossary?.terms?.length) return [];

  const pool = glossary.terms.filter(t =>
    t.niche === niche && t.hook_potential === 'high'
  );
  if (!pool.length) return glossary.terms.slice(0, count);

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

module.exports = { getWeeklyTerms, formatForPrompt, getAngleSeedTerms };
