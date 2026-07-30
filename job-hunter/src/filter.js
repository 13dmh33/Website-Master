// filter.js — Stage 2. A cheap rules pass with zero API cost.
//
// Runs before any Claude call (free-before-paid). It drops jobs that clearly
// fail hard preferences so the paid scorer only ever sees plausible matches:
//   - deal-breaker keywords in the title/description
//   - obvious seniority mismatch (interns, executive tiers, when not wanted)
//
// It is deliberately conservative — when in doubt it keeps the job and lets the
// scorer judge. Each drop records a plain-language reason for the run log.
//
// Location is no longer a hard filter here (removed 2026-07-30 — see
// CHANGE_REQUEST.md). It used to drop any job whose location didn't match a
// target city and wasn't remote, while treating an EMPTY location as neutral —
// an asymmetry where a location-PARSING failure (garbled text) was punished
// harder than having no location data at all. Location is now a scored
// dimension in scorer.js (see lib/location.js#classifyLocation), not an
// exclusion gate — nothing gets dropped from the pipeline over location alone.

import { makeLogger } from './lib/log.js';
import { normalize } from './lib/dedup.js';

const log = makeLogger('filter');

const EXEC_TERMS = ['vp', 'vice president', 'svp', 'chief', 'cxo', 'ceo', 'cfo', 'coo', 'cto', 'director', 'head of'];
const INTERN_TERMS = ['intern', 'internship', 'co-op', 'apprentice'];

function haystack(job) {
  return `${normalize(job.title)} ${normalize(job.description)}`;
}

function failsDealBreaker(job, prefs) {
  const hay = haystack(job);
  for (const kw of prefs.deal_breaker) {
    if (hay.includes(normalize(kw))) return kw;
  }
  return null;
}

function failsSeniority(job, prefs) {
  if (!prefs.seniority.length) return null;
  const wants = prefs.seniority.map(normalize);
  const title = normalize(job.title);
  const wantsIntern = wants.some((w) => INTERN_TERMS.includes(w) || w === 'entry' || w === 'junior');
  const wantsExec = wants.some((w) => ['exec', 'executive', 'director', 'vp'].includes(w));

  if (!wantsIntern && INTERN_TERMS.some((t) => title.includes(t))) {
    return 'intern-level role (seniority mismatch)';
  }
  if (!wantsExec && EXEC_TERMS.some((t) => title.includes(t))) {
    return 'executive-tier role (seniority mismatch)';
  }
  return null;
}

export function runFilter(jobs, prefs) {
  const kept = [];
  const dropped = [];
  for (const job of jobs) {
    const reason =
      (failsDealBreaker(job, prefs) && `deal-breaker keyword: ${failsDealBreaker(job, prefs)}`) ||
      failsSeniority(job, prefs);
    if (reason) dropped.push({ job, reason });
    else kept.push(job);
  }
  log.info(`kept ${kept.length}, dropped ${dropped.length} on rules (no API cost).`);
  return { kept, dropped };
}
