// scorer.js — Stage 3. Score the shortlist with Claude Haiku, add the freshness
// bonus, and keep everything at or above MIN_SCORE.
//
// Cost tiering: only jobs that survived the free rules filter reach this stage.
// Each survivor gets one cheap Haiku call: fit 0-100, a one-line rationale, and
// the top 3 keywords to mirror.
//
// Recency is baked into ranking, legibly:
//   blended = min(100, rawFit + freshnessBonus)
//   where freshnessBonus is +15 (<2d), +8 (<7d), +3 (<14d), +0 (older).
// So a fresh 75 outranks a stale 82. The digest shows both numbers.
//
// Feedback calibration: we pass the last ~10 jobs Dave marked applied / passed /
// interview in the tracker sheet as examples, so scoring tracks his real taste.
// If the sheet has no marked rows yet, this is skipped cleanly.

import crypto from 'node:crypto';
import { config, has } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { scoreJob } from './lib/claude.js';
import { readFeedbackExamples } from './lib/sheets.js';
import { freshnessBonus, blendScore } from './lib/recency.js';
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

export async function runScorer(jobs, { profile, preferencesText, minScore, now = new Date(), state } = {}) {
  const threshold = minScore ?? config.minScore;

  if (!has.claude()) {
    log.warn('ANTHROPIC_API_KEY not set — cannot score. Returning no matches.');
    return { matches: [], scoredCount: 0 };
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
      const { fit, rationale, keywords } = result;
      const bonus = freshnessBonus(job, now);
      const blended = blendScore(fit, bonus);
      scored.push({ ...job, fit, rationale, keywords, freshnessBonus: bonus, blended });
    } catch (e) {
      log.warn(`scoring failed for "${job.title}" @ ${job.company}: ${e.message}`);
    }
  }

  const matches = scored
    .filter((j) => j.blended >= threshold)
    .sort((a, b) => b.blended - a.blended || b.freshnessBonus - a.freshnessBonus);

  log.info(
    `scored ${scored.length} (${cacheHits} from cache, ${scored.length - cacheHits} new Haiku calls), ` +
      `${matches.length} at/above blended ${threshold}.`,
  );
  return { matches, scoredCount: scored.length };
}
