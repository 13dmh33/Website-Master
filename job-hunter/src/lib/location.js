// location.js — classifies a job's location for SCORING, not exclusion.
//
// Replaces filter.js's old failsLocation() hard drop. That gate treated an
// empty location as neutral but a non-empty, unmatched, or garbled one as a
// hard exclusion — meaning a location-PARSING failure produced a worse
// outcome than simply having no location data. classifyLocation() turns
// location into an additive scoring term instead, so nothing gets silently
// excluded from the pipeline over a location string alone.
//
// UNKNOWN is defined narrowly: an empty location field only. There is no
// text-only way to distinguish a real-but-unfamiliar place name (e.g. "Colorado
// Springs, El Paso County" — a genuine Adzuna display_name with no state token)
// from a garbled one (e.g. "Philatelic, Alameda County") without an actual
// geographic database, which this module does not have and does not pretend to
// have. A non-empty, unrecognized string still reaches ONSITE and gets the
// same softened penalty a real non-matching city would — see CHANGE_REQUEST.md.

import { normalize } from './dedup.js';

export const LOCATION_DELTA = {
  REMOTE: 0,
  ONSITE_MATCH: 0,
  ONSITE_MISMATCH: -15,
  HYBRID_MATCH: 0,
  HYBRID_MISMATCH: -15,
  UNKNOWN: 0,
  MULTI: 0,
};

const MULTI_TEXT_PATTERN = /\bmultiple locations?\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;

function isMultiLocation(job) {
  const text = `${job.title || ''} ${job.location || ''}`;
  if (MULTI_TEXT_PATTERN.test(text)) return true;
  // A location field listing several distinct places, e.g. "Austin, TX; Denver, CO"
  // or "Austin, TX / Denver, CO" — a single real "City, ST"/"City, County" has at
  // most one comma, so 2+ separators here means more than one place is listed.
  const separators = (job.location || '').match(/[;/]|(?:\band\b)/gi) || [];
  return separators.length >= 1 && /,/.test(job.location || '');
}

function matchesTargetLocation(job, prefs) {
  const locs = (prefs.location || []).filter((l) => !/remote/i.test(l));
  if (!locs.length) return true; // no location constraint configured — nothing to fail
  const jobLoc = normalize(job.location);
  if (!jobLoc) return false;
  return locs.some((l) => jobLoc.includes(normalize(l).split(' ')[0]));
}

/**
 * classifyLocation(job, prefs) -> { state, isMulti, delta, evidence }
 *
 * state: 'REMOTE' | 'ONSITE' | 'HYBRID' | 'UNKNOWN'
 * isMulti: true when the posting spans multiple locations (independent of state)
 * delta: the scoring adjustment to add alongside fit + freshness
 * evidence: one human-readable line for the digest
 */
export function classifyLocation(job, prefs = {}) {
  const multi = isMultiLocation(job);
  if (multi) {
    return {
      state: 'MULTI',
      isMulti: true,
      delta: LOCATION_DELTA.MULTI,
      evidence: `location: MULTI — posting lists multiple locations — +0 (neutral)`,
    };
  }

  const rawLocation = (job.location || '').trim();
  if (!rawLocation) {
    return {
      state: 'UNKNOWN',
      isMulti: false,
      delta: LOCATION_DELTA.UNKNOWN,
      evidence: `location: UNKNOWN — no location captured — +0 (neutral)`,
    };
  }

  if (job.remote || /remote/i.test(rawLocation)) {
    return {
      state: 'REMOTE',
      isMulti: false,
      delta: LOCATION_DELTA.REMOTE,
      evidence: `location: REMOTE — "${rawLocation}" — +0`,
    };
  }

  const matches = matchesTargetLocation(job, prefs);

  if (HYBRID_PATTERN.test(`${job.title || ''} ${job.description || ''} ${rawLocation}`)) {
    const delta = matches ? LOCATION_DELTA.HYBRID_MATCH : LOCATION_DELTA.HYBRID_MISMATCH;
    return {
      state: 'HYBRID',
      isMulti: false,
      delta,
      evidence: matches
        ? `location: HYBRID — "${rawLocation}" matches target — +0`
        : `location: HYBRID — "${rawLocation}" does not match target areas — ${delta}`,
    };
  }

  const delta = matches ? LOCATION_DELTA.ONSITE_MATCH : LOCATION_DELTA.ONSITE_MISMATCH;
  return {
    state: 'ONSITE',
    isMulti: false,
    delta,
    evidence: matches
      ? `location: ONSITE — "${rawLocation}" matches target — +0`
      : `location: ONSITE — "${rawLocation}" does not match target areas, not remote — ${delta}`,
  };
}
