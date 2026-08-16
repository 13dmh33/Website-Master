// index.js — the orchestrator. Runs stages 0 -> 5 in order.
//
//   0. ingest   ensure the master profile + preferences exist (Step 0)
//   1. scout    pull, normalize, dedup, age cutoff
//   -  dedup    drop anything already delivered in a prior digest (no repeats)
//   2. filter   cheap rules pass, no API cost
//   3. scorer   Claude Haiku fit score + freshness bonus (>= MIN_SCORE)
//   4. tailor   Claude Sonnet resume + cover letter for the top matches
//   5. reporter build + email the digest, log to the sheet, record state
//
// Flags:
//   --dry-run        pull + filter + score + preview digest, but no email,
//                    no sheet write, and no state change
//   --limit N        cap how many jobs get tailored (default DAILY_LIMIT)
//   --min-score N    override MIN_SCORE for this run
//
// One command: `npm run daily` (or `npm run daily -- --dry-run`).

import fs from 'node:fs';
import { config } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { loadState, saveState } from './lib/state.js';
import { readPreferences } from './lib/preferences.js';
import { runIngest } from './ingest.js';
import { runScout } from './scout.js';
import { runFilter } from './filter.js';
import { runScorer } from './scorer.js';
import { runTailor } from './tailor.js';
import { runCareerCoach } from './career-coach.js';
import { runReporter } from './reporter.js';

const log = makeLogger('daily');

function parseArgs(argv) {
  const args = { dryRun: false, limit: config.dailyLimit, minScore: config.minScore };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--min-score') args.minScore = Number(argv[++i]);
  }
  return args;
}

function loadProfile() {
  try {
    return JSON.parse(fs.readFileSync(config.paths.masterProfile, 'utf8'));
  } catch {
    return null;
  }
}

// All job ids already delivered in a previous digest — excluded so nothing
// repeats across runs.
function deliveredIds(state) {
  const set = new Set();
  for (const d of state.digests || []) for (const id of d.jobIds || []) set.add(id);
  return set;
}

export async function runDaily(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const now = new Date();
  log.info(`starting daily run${args.dryRun ? ' (dry-run)' : ''} — min-score ${args.minScore}, limit ${args.limit}.`);

  // Stage 0: make sure profile + preferences exist.
  let profile = loadProfile();
  if (!profile) {
    log.info('no master profile yet — running ingest (Step 0).');
    await runIngest();
    profile = loadProfile();
  }
  if (!profile) {
    log.error('cannot run without a parsed resume. Drop inputs/master-resume.docx or .pdf and run `npm run ingest`.');
    return { ok: false, reason: 'no-profile' };
  }

  const { prefs, text: preferencesText, exists } = readPreferences();
  if (!exists) {
    log.warn('preferences.md was missing — ingest scaffolded it. Using defaults for now; edit it for better results.');
  }

  const state = loadState();
  const already = deliveredIds(state);

  // Stage 1: scout (mutates state.seen; we persist once at the end).
  const { jobs } = await runScout({ state, prefs, maxAgeDays: config.maxAgeDays, now, persist: false });

  // Dedup: drop jobs already delivered in a prior digest.
  const fresh = jobs.filter((j) => !already.has(j.id));
  log.info(`${fresh.length} jobs after excluding ${jobs.length - fresh.length} already-delivered.`);

  // Stage 2: cheap rules filter.
  const { kept } = runFilter(fresh, prefs);

  // Stage 3: score with Haiku + freshness bonus + location adjustment. Passing
  // state lets the scorer reuse a cached score for a job it already scored
  // under the same profile/preferences instead of paying for another Haiku
  // call (see scorer.js). `prefs` feeds lib/location.js#classifyLocation.
  const { matches, duplicateFitWarning, bandMismatchWarning, scoredCount } = await runScorer(kept, {
    profile,
    preferencesText,
    prefs,
    minScore: args.minScore,
    now,
    state,
  });

  // Stage 4: tailor the top matches with Sonnet.
  const tailored = await runTailor(matches, {
    profile,
    preferencesText,
    limit: args.limit,
    dryRun: args.dryRun,
    now,
  });

  // Stage 4b: career-coach review — runs alongside Stage 4, not replacing it.
  // Re-ranks `matches` (not `tailored`) against Dave's own career-context
  // brief, since this re-ranking is allowed to promote a job Stage 4's
  // scorer-order tailoring never reached. Attaches job.careerCoach onto the
  // matching entry in `tailored` by id, adding a new entry (with no
  // tailor.js deliverables) if the career-coach's pick wasn't already there.
  const careerCoachResults = await runCareerCoach(matches, { now, dryRun: args.dryRun });
  const tailoredById = new Map(tailored.map((j) => [j.id, j]));
  for (const { job, careerCoach } of careerCoachResults) {
    const existing = tailoredById.get(job.id);
    if (existing) {
      existing.careerCoach = careerCoach;
    } else {
      const added = { ...job, deliverables: null, careerCoach };
      tailored.push(added);
      tailoredById.set(job.id, added);
    }
  }

  // Cap what the digest lists. Career-coach picks are kept regardless of where
  // they landed on blended score — the coach is explicitly allowed to promote a
  // job the scorer ranked low, and cutting it by score would discard the one
  // judgment the second opinion exists to produce. Remaining slots fill by
  // blended, in order. Trimmed jobs are NOT recorded as delivered (recordDigest
  // only sees what it is passed), so they stay eligible for tomorrow rather
  // than vanishing unseen.
  const digestCap = config.digestLimit > 0 ? config.digestLimit : Infinity;
  let forDigest = tailored;
  if (tailored.length > digestCap) {
    const coachPicks = tailored.filter((j) => j.careerCoach);
    const rest = tailored.filter((j) => !j.careerCoach).sort((a, b) => b.blended - a.blended);
    forDigest = [...coachPicks, ...rest.slice(0, Math.max(0, digestCap - coachPicks.length))].sort(
      (a, b) => b.blended - a.blended,
    );
    log.info(
      `digest capped at ${forDigest.length} of ${tailored.length} matches (DIGEST_LIMIT=${config.digestLimit}); ` +
        `${tailored.length - forDigest.length} held back for a later run, not marked delivered.`,
    );
  }

  // Stage 5: digest (email + sheet + state).
  await runReporter(forDigest, {
    state,
    now,
    dryRun: args.dryRun,
    duplicateFitWarning,
    bandMismatchWarning,
    heldBack: tailored.length - forDigest.length,
    // Stage counts, so a zero-match day can report where the funnel emptied
    // instead of just saying nothing came through.
    pipeline: {
      pulled: jobs.length,
      fresh: fresh.length,
      filtered: kept.length,
      scored: scoredCount,
      threshold: args.minScore ?? config.minScore,
    },
  });

  // Persist the append-only state once, unless this was a dry run.
  if (!args.dryRun) {
    saveState(state);
    log.info('state saved (seen ledger + digest record updated).');
  } else {
    log.info('dry-run complete — state.json left unchanged.');
  }

  log.info(`done. ${tailored.length} match${tailored.length === 1 ? '' : 'es'} in today's digest.`);
  return { ok: true, matches: tailored.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDaily().catch((e) => {
    console.error('[daily] failed:', e.message);
    process.exit(1);
  });
}
