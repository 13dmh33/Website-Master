// recency.js — everything about how fresh a posting is.
//
// Recency is a first-class ranking signal here, not just a filter, because
// timing drives callback odds. Two jobs with equal raw fit should not tie: the
// fresher one wins. This module owns:
//   - ageDays(job):      how old a posting is, in whole days
//   - freshnessBonus():  the legible bonus buckets added to the fit score
//   - withinMaxAge():    the hard cutoff applied before any Claude call
//
// The buckets are deliberately simple and shown in the digest so the ranking is
// explainable, not a black box.

export function daysBetween(fromIso, toDate = new Date()) {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return null;
  const ms = toDate.getTime() - from;
  return ms / (1000 * 60 * 60 * 24);
}

// Best available "how old is this posting" signal. Prefer the source's real
// posted date; fall back to firstSeenAt (when the pipeline first observed it).
export function ageDays(job, now = new Date()) {
  const basis = job.postedAt || job.firstSeenAt;
  if (!basis) return null;
  const d = daysBetween(basis, now);
  return d === null ? null : Math.max(0, d);
}

// Freshness bonus added to the raw fit score. Legible buckets, per the spec:
//   posted < 2 days  -> +15
//   posted < 7 days  -> +8
//   posted < 14 days -> +3
//   older            -> +0
export function freshnessBonus(job, now = new Date()) {
  const age = ageDays(job, now);
  if (age === null) return 0;
  if (age < 2) return 15;
  if (age < 7) return 8;
  if (age < 14) return 3;
  return 0;
}

// Hard age cutoff (drops stale jobs before they cost a Claude call).
export function withinMaxAge(job, maxAgeDays, now = new Date()) {
  const age = ageDays(job, now);
  if (age === null) return true; // unknown age: keep, let scoring decide
  return age <= maxAgeDays;
}

// Human-friendly age label for the digest, e.g. "posted today", "3 days ago".
export function ageLabel(job, now = new Date()) {
  const age = ageDays(job, now);
  if (age === null) return 'age unknown';
  const whole = Math.floor(age);
  if (whole <= 0) return 'posted today';
  if (whole === 1) return '1 day ago';
  return `${whole} days ago`;
}

// Blend a raw fit score (0-100) with the freshness bonus, capped at 100.
export function blendScore(rawFit, bonus) {
  return Math.min(100, Math.round(rawFit + bonus));
}
