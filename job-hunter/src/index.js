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

  // Stage 3: score with Haiku + freshness bonus.
  const { matches } = await runScorer(kept, {
    profile,
    preferencesText,
    minScore: args.minScore,
    now,
  });

  // Stage 4: tailor the top matches with Sonnet.
  const tailored = await runTailor(matches, {
    profile,
    preferencesText,
    limit: args.limit,
    dryRun: args.dryRun,
    now,
  });

  // Stage 5: digest (email + sheet + state).
  await runReporter(tailored, { state, now, dryRun: args.dryRun });

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
