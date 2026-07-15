// preferences.js — read inputs/preferences.md.
//
// The file is human-editable Markdown. Two things live in it:
//   1. A fenced ```config block with machine-readable settings (which ATS
//      boards to pull, search queries, locations, deal-breakers, comp floor).
//      Parsed here into a structured object for scout + filter.
//   2. Everything else is free prose, passed verbatim to the Claude scorer and
//      tailor so Dave can add nuance in plain language.
//
// No YAML dependency — the config block is a simple `key: value` list. Repeated
// keys and comma-separated values both accumulate into arrays.

import fs from 'node:fs';
import { config } from './config.js';

const LIST_KEYS = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'adzuna_query',
  'location',
  'title',
  'seniority',
  'deal_breaker',
  'must_have',
]);

function emptyPrefs() {
  return {
    greenhouse: [],
    lever: [],
    ashby: [],
    adzuna_query: [],
    location: [],
    title: [],
    seniority: [],
    deal_breaker: [],
    must_have: [],
    remote_ok: true,
    include_federal: false,
    comp_floor: null,
  };
}

function parseConfigBlock(md) {
  const prefs = emptyPrefs();
  const match = md.match(/```config\s*\n([\s\S]*?)```/i);
  if (!match) return prefs;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    if (LIST_KEYS.has(key)) {
      for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
        prefs[key].push(part);
      }
    } else if (key === 'remote_ok' || key === 'include_federal') {
      prefs[key] = /^(true|yes|1)$/i.test(value);
    } else if (key === 'comp_floor') {
      const n = Number(value.replace(/[^0-9.]/g, ''));
      prefs.comp_floor = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return prefs;
}

// Returns { prefs, text }. `text` is the full markdown (used by Claude).
// If the file is missing, returns empty prefs and empty text — the caller
// decides whether that is fatal (scout warns and pulls nothing).
export function readPreferences() {
  let md = '';
  try {
    md = fs.readFileSync(config.paths.preferences, 'utf8');
  } catch {
    return { prefs: emptyPrefs(), text: '', exists: false };
  }
  return { prefs: parseConfigBlock(md), text: md, exists: true };
}
