// dedup.js — exact dedup + near-duplicate merge across sources.
//
// Two levels, per the spec:
//   1. Exact id: hash(source + company + title + url). Used against state.json
//      so a job already seen on a prior run never repeats.
//   2. Near-dup merge: the same role often shows up on both the company's ATS
//      (Greenhouse/Lever/Ashby) and the Adzuna aggregator. We fuzzy-match on
//      company + title + location, keep the freshest, and prefer the direct ATS
//      link over the aggregator link because direct applications convert better.
//
// No dependencies — a small deterministic hash and simple string normalization.

import crypto from 'node:crypto';

// Stable id for a job. Deterministic across runs and machines.
export function jobId(job) {
  const basis = [job.source, job.company, job.title, job.url]
    .map((s) => normalize(s))
    .join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Aggregators we would rather replace with a direct company link when we can.
const AGGREGATOR_SOURCES = new Set(['adzuna']);

function isAggregator(job) {
  return AGGREGATOR_SOURCES.has(job.source);
}

// Fuzzy key for near-dup detection: company + normalized title + coarse location.
function fuzzyKey(job) {
  const company = normalize(job.company);
  // Collapse common seniority/format noise so "Senior Analyst" and "Sr Analyst"
  // fuzzy-match, without being so aggressive we merge genuinely different roles.
  const title = normalize(job.title)
    .replace(/\b(sr|snr)\b/g, 'senior')
    .replace(/\b(jr)\b/g, 'junior')
    .replace(/\b(remote|hybrid|onsite|contract|full time|part time)\b/g, '')
    .trim();
  // Canonical location: collapse any "remote" variant to just "remote"
  // ("Remote" vs "Remote, US" must match); otherwise key on the city token.
  const locNorm = normalize(job.location);
  const loc = locNorm.includes('remote') ? 'remote' : locNorm.split(' ')[0];
  return `${company}::${title}::${loc}`;
}

function freshnessBasis(job) {
  const d = new Date(job.postedAt || job.firstSeenAt || 0).getTime();
  return Number.isFinite(d) ? d : 0;
}

// Merge near-duplicates within a batch. Keeps the freshest record, and when
// tied prefers the company ATS link over an aggregator link.
export function mergeNearDuplicates(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const key = fuzzyKey(job);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, job);
      continue;
    }
    byKey.set(key, pickBetter(existing, job));
  }
  return [...byKey.values()];
}

function pickBetter(a, b) {
  // Prefer the direct ATS link over the aggregator regardless of a small age
  // gap — a direct application is worth more than a day or two of freshness.
  const aAgg = isAggregator(a);
  const bAgg = isAggregator(b);
  if (aAgg !== bAgg) {
    const direct = aAgg ? b : a;
    const agg = aAgg ? a : b;
    // Carry the freshest postedAt onto the kept (direct) record.
    if (freshnessBasis(agg) > freshnessBasis(direct) && agg.postedAt) {
      return { ...direct, postedAt: direct.postedAt || agg.postedAt };
    }
    return direct;
  }
  // Same channel type: keep the freshest.
  return freshnessBasis(b) >= freshnessBasis(a) ? b : a;
}
