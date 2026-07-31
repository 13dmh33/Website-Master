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
//
// Prefers job.externalId (a source's own stable ad/listing id) over job.url
// when present — some sources (Adzuna) hand back a click-through/tracking
// URL that can differ between separate pulls of the same real posting, which
// would otherwise make the same job hash to a different id every run.
export function jobId(job) {
  const identity = job.externalId || job.url;
  const basis = [job.source, job.company, job.title, identity]
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
  // Also collapse when job.remote is true even if the location field lists a
  // real city — some postings (e.g. Georgia-Pacific's "National Account
  // Manager - Foodservice - Remote") are genuinely remote but list a specific
  // city per listing, which previously produced a distinct fuzzy key per city
  // and let the same remote role survive near-dup merge multiple times.
  const locNorm = normalize(job.location);
  const loc = job.remote || locNorm.includes('remote') ? 'remote' : locNorm.split(' ')[0];
  return `${company}::${title}::${loc}`;
}

function freshnessBasis(job) {
  const d = new Date(job.postedAt || job.firstSeenAt || 0).getTime();
  return Number.isFinite(d) ? d : 0;
}

// Key ignoring location entirely — used by the second pass below.
function companyTitleKey(job) {
  const title = normalize(job.title)
    .replace(/\b(sr|snr)\b/g, 'senior')
    .replace(/\b(jr)\b/g, 'junior')
    .replace(/\b(remote|hybrid|onsite|contract|full time|part time)\b/g, '')
    .trim();
  return `${normalize(job.company)}::${title}`;
}

// Merge near-duplicates within a batch. Keeps the freshest record, and when
// tied prefers the company ATS link over an aggregator link.
//
// Two passes, because location is load-bearing in opposite directions:
//
//   Pass 1 (fuzzyKey, location-aware) merges the same role listed on both an
//   ATS and an aggregator, and collapses remote roles listed under different
//   cities.
//
//   Pass 2 (companyTitleKey, location-blind) catches what pass 1 structurally
//   cannot: one req blasted across many nearby ONSITE localities. Real case,
//   2026-07-31 — Bayer posted an identical "National Account Director - Health
//   Systems - Western USA" to Adzuna under seven Washington towns (Normandy
//   Park, Othello, University Place, Tumwater, Warden, Issaquah,
//   "International"), each with its own ad id. Pass 1 keys on the city token
//   for non-remote jobs, so all seven survived, consumed seven of the eight
//   DAILY_LIMIT tailoring slots (seven paid Sonnet calls all overwriting the
//   same output directory, since company+title produce one slug), and crowded
//   every other opportunity out of that morning's digest.
//
// The alternate locations are rolled up onto the kept record as
// `alsoPostedIn` rather than dropped, so the breadth of a genuinely
// multi-location posting is still visible.
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

  const byCompanyTitle = new Map();
  for (const job of byKey.values()) {
    const key = companyTitleKey(job);
    const existing = byCompanyTitle.get(key);
    if (!existing) {
      byCompanyTitle.set(key, job);
      continue;
    }
    const kept = pickBetter(existing, job);
    const dropped = kept === existing ? job : existing;
    const locations = new Set([
      ...(existing.alsoPostedIn || []),
      ...(job.alsoPostedIn || []),
    ]);
    if (dropped.location) locations.add(dropped.location);
    locations.delete(kept.location);
    byCompanyTitle.set(key, locations.size ? { ...kept, alsoPostedIn: [...locations] } : kept);
  }
  return [...byCompanyTitle.values()];
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
