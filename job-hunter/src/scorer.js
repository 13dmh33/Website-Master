// scorer.js — Stage 3. Score the shortlist with Claude Haiku, add the freshness
// bonus + location adjustment, and keep everything at or above MIN_SCORE.
//
// Cost tiering: only jobs that survived the free rules filter reach this stage.
// Each survivor gets one cheap Haiku call: fit 0-100, a one-line rationale, and
// the top 3 keywords to mirror.
//
// Recency is baked into ranking, legibly:
//   blended = min(100, rawFit + freshnessBonus + locationDelta)
//   where freshnessBonus is +15 (<2d), +8 (<7d), +3 (<14d), +0 (older), and
//   locationDelta comes from lib/location.js#classifyLocation (REMOTE/ONSITE-
//   match/HYBRID-match/UNKNOWN/MULTI = +0, ONSITE- or HYBRID-mismatch = -15).
//   Location used to be a Stage-2 hard drop (filter.js#failsLocation, removed
//   2026-07-30 — see CHANGE_REQUEST.md); it's additive scoring now, so nothing
//   gets excluded from the pipeline over a location string alone.
// So a fresh 75 outranks a stale 82. The digest shows all three numbers.
//
// Feedback calibration: we pass the last ~10 jobs Dave marked applied / passed /
// interview in the tracker sheet as examples, so scoring tracks his real taste.
// If the sheet has no marked rows yet, this is skipped cleanly.

import crypto from 'node:crypto';
import { config, has } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { scoreJob } from './lib/claude.js';
import { readFeedbackExamples } from './lib/sheets.js';
import { freshnessBonus } from './lib/recency.js';
import { classifyLocation } from './lib/location.js';
import { getCachedScore, cacheScore } from './lib/state.js';

const log = makeLogger('scorer');

// Fingerprints the profile + preferences that drive scoring. Unchanged between
// runs unless the resume or preferences.md changes — used to key the score
// cache so a job already scored under the same profile/preferences is never
// re-sent to Haiku, while a genuine change (new resume, edited preferences)
// correctly invalidates every cached score at once.
function scoringFingerprint(profile, preferencesText) {
  return crypto.createHash('sha1').update(JSON.stringify(profile) + '|' + (preferencesText || '')).digest('hex');
}

// Duplicate-fit-score check (Change 3) — if 2+ jobs in one run share the exact
// same raw Claude fit score, that can mean the model returned a default/lazy
// value instead of a genuinely differentiated one. Purely informational: never
// changes ranking or filtering, just surfaces a data-quality signal to spot-check.
function findDuplicateFitWarning(scored) {
  if (!scored.length) return null;
  const counts = new Map();
  for (const j of scored) counts.set(j.fit, (counts.get(j.fit) || 0) + 1);

  // Fires only when one value swallows more than half the batch.
  //
  // The old test was "2+ jobs share a score", which sounds like a lazy-output
  // check and is really a birthday-paradox check: with ~178 jobs landing on 22
  // possible values, collisions are arithmetic, not evidence. It fired on every
  // run — the last one produced fifteen near-identical sentences, all pasted
  // into the digest, burying the single line that mattered. A guard that always
  // fires only teaches you to ignore the guard. Band/fit disagreement is now
  // the real signal; this stays as a blunt backstop for total collapse.
  const [topFit, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCount <= scored.length / 2) return null;
  const pct = Math.round((topCount / scored.length) * 100);
  return (
    `${topCount} of ${scored.length} scores (${pct}%) came back as exactly ${topFit} — more than ` +
    `half the batch on one value, which usually means the model stopped differentiating. ` +
    `Spot-check before trusting this run.`
  );
}

export async function runScorer(jobs, { profile, preferencesText, prefs, minScore, now = new Date(), state } = {}) {
  const threshold = minScore ?? config.minScore;

  if (!has.claude()) {
    log.warn('ANTHROPIC_API_KEY not set — cannot score. Returning no matches.');
    return { matches: [], scoredCount: 0, duplicateFitWarning: null };
  }

  let feedback = [];
  try {
    feedback = await readFeedbackExamples(10);
    if (feedback.length) log.info(`calibrating with ${feedback.length} marked rows from the tracker sheet.`);
  } catch (e) {
    log.warn(`could not read feedback rows (continuing without calibration): ${e.message}`);
  }

  const fingerprint = scoringFingerprint(profile, preferencesText);
  const scored = [];
  let cacheHits = 0;
  for (const job of jobs) {
    try {
      let result = state && getCachedScore(state, job.id, fingerprint);
      if (result) {
        cacheHits++;
      } else {
        result = await scoreJob({ job, profile, preferencesText, feedbackExamples: feedback });
        if (state) cacheScore(state, job.id, fingerprint, result);
      }
      const { fit, band, bandMismatch, rationale, keywords } = result;
      const bonus = freshnessBonus(job, now);
      const location = classifyLocation(job, prefs || {});
      const blended = Math.min(100, Math.round(fit + bonus + location.delta));
      scored.push({
        ...job,
        fit,
        band: band || null,
        bandMismatch: bandMismatch || null,
        rationale,
        keywords,
        freshnessBonus: bonus,
        locationState: location.state,
        locationDelta: location.delta,
        locationEvidence: location.evidence,
        isMulti: location.isMulti,
        blended,
      });
    } catch (e) {
      log.warn(`scoring failed for "${job.title}" @ ${job.company}: ${e.message}`);
    }
  }

  const matches = scored
    .filter((j) => j.blended >= threshold)
    .sort((a, b) => b.blended - a.blended || b.freshnessBonus - a.freshnessBonus);

  const duplicateFitWarning = findDuplicateFitWarning(scored);

  // Band/fit disagreement — the replacement quality signal. Counted rather than
  // enumerated: one number is readable, 178 sentences are not.
  const mismatches = scored.filter((j) => j.bandMismatch);
  const bandMismatchWarning = mismatches.length
    ? `${mismatches.length} of ${scored.length} scores disagreed with their own band ` +
      `(e.g. ${mismatches[0].bandMismatch}) — spot-check these.`
    : null;

  log.info(
    `scored ${scored.length} (${cacheHits} from cache, ${scored.length - cacheHits} new Haiku calls), ` +
      `${matches.length} at/above blended ${threshold}.`,
  );
  if (bandMismatchWarning) log.warn(bandMismatchWarning);
  if (duplicateFitWarning) log.warn(duplicateFitWarning);

  return {
    matches,
    scoredCount: scored.length,
    duplicateFitWarning,
    bandMismatchWarning,
    bandMismatchCount: mismatches.length,
    scored,
  };
}
