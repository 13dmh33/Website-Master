// filter.js — Stage 2. A cheap rules pass with zero API cost.
//
// Runs before any Claude call (free-before-paid). It drops jobs that clearly
// fail hard preferences so the paid scorer only ever sees plausible matches:
//   - deal-breaker keywords in the title/description
//   - location / remote mismatch
//   - obvious seniority mismatch (interns, executive tiers, when not wanted)
//
// It is deliberately conservative — when in doubt it keeps the job and lets the
// scorer judge. Each drop records a plain-language reason for the run log.

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

function failsLocation(job, prefs) {
  if (job.remote && prefs.remote_ok) return null; // remote is fine
  const locs = prefs.location.filter((l) => !/remote/i.test(l));
  if (!locs.length) return null; // no location constraint configured
  if (job.remote) return null; // still remote, acceptable superset
  const jobLoc = normalize(job.location);
  if (!jobLoc) return null; // unknown location: let the scorer decide
  const ok = locs.some((l) => {
    const city = normalize(l).split(' ')[0];
    return jobLoc.includes(city);
  });
  return ok ? null : `location "${job.location}" not in target areas and not remote`;
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
      failsLocation(job, prefs) ||
      failsSeniority(job, prefs);
    if (reason) dropped.push({ job, reason });
    else kept.push(job);
  }
  log.info(`kept ${kept.length}, dropped ${dropped.length} on rules (no API cost).`);
  return { kept, dropped };
}
