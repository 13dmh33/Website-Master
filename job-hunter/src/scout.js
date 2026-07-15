// scout.js — Stage 1. Pull postings, normalize, dedup, apply the age cutoff.
//
// Sources: Greenhouse / Lever / Ashby boards for each configured slug, the
// Adzuna keyword+location search, and (optional) USAJobs. Every source is
// normalized to one shape:
//   { id, source, company, title, location, remote, url, description,
//     postedAt, firstSeenAt, isNew }
//
// Recency is handled here up front:
//   - real postedAt per source (Greenhouse updated_at, Lever createdAt, Ashby
//     publishedAt, Adzuna created, USAJobs PublicationStartDate), falling back
//     to firstSeenAt when a source hides the date
//   - fetch recent-first where the source supports it (Adzuna, USAJobs)
//   - drop anything older than MAX_AGE_DAYS before it can cost a Claude call
//   - exact dedup against state.json by stable id, then near-dup merge across
//     sources (keep freshest, prefer the direct ATS link over the aggregator)

import { config, has } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { readPreferences } from './lib/preferences.js';
import { loadState, saveState, markSeen, isSeen } from './lib/state.js';
import { jobId, mergeNearDuplicates } from './lib/dedup.js';
import { withinMaxAge } from './lib/recency.js';

import { pullGreenhouse } from './sources/greenhouse.js';
import { pullLever } from './sources/lever.js';
import { pullAshby } from './sources/ashby.js';
import { pullAdzuna } from './sources/adzuna.js';
import { pullUsajobs } from './sources/usajobs.js';

const log = makeLogger('scout');

async function pullBoard(pullFn, slugs, label) {
  const out = [];
  for (const slug of slugs) {
    try {
      const batch = await pullFn(slug);
      out.push(...batch);
      log.info(`${label}:${slug} -> ${batch.length} postings`);
    } catch (e) {
      log.warn(`${label}:${slug} failed: ${e.message}`);
    }
  }
  return out;
}

// Pull from every configured source and return raw normalized postings
// (before id assignment, dedup, and age cutoff).
export async function pullAll(prefs, { maxAgeDays } = {}) {
  const maxAge = maxAgeDays ?? config.maxAgeDays;
  const raw = [];

  raw.push(...(await pullBoard(pullGreenhouse, prefs.greenhouse, 'greenhouse')));
  raw.push(...(await pullBoard(pullLever, prefs.lever, 'lever')));
  raw.push(...(await pullBoard(pullAshby, prefs.ashby, 'ashby')));

  if (has.adzuna()) {
    try {
      const batch = await pullAdzuna(prefs, { maxDaysOld: maxAge });
      raw.push(...batch);
      log.info(`adzuna -> ${batch.length} postings`);
    } catch (e) {
      log.warn(`adzuna failed: ${e.message}`);
    }
  } else {
    log.info('adzuna skipped (ADZUNA_APP_ID / ADZUNA_APP_KEY not set).');
  }

  if (prefs.include_federal && has.usajobs()) {
    try {
      const batch = await pullUsajobs(prefs, { maxDaysOld: maxAge });
      raw.push(...batch);
      log.info(`usajobs -> ${batch.length} postings`);
    } catch (e) {
      log.warn(`usajobs failed: ${e.message}`);
    }
  } else if (prefs.include_federal) {
    log.info('usajobs requested but not configured (USAJOBS_API_KEY / USAJOBS_EMAIL) — skipping.');
  }

  return raw;
}

// Full scout stage: pull -> id -> firstSeenAt -> age cutoff -> near-dup merge.
// Mutates `state` (append-only markSeen); the caller decides whether to persist.
export async function runScout({ state, prefs, maxAgeDays, now = new Date(), persist = false } = {}) {
  const s = state || loadState();
  const p = prefs || readPreferences().prefs;
  const maxAge = maxAgeDays ?? config.maxAgeDays;

  const raw = await pullAll(p, { maxAgeDays: maxAge });
  const nowIso = now.toISOString();

  // Assign stable ids and firstSeenAt (append-only). Track new vs already-seen.
  const withIds = raw.map((job) => {
    const id = jobId(job);
    const wasSeen = isSeen(s, id);
    const firstSeenAt = markSeen(s, { ...job, id }, nowIso);
    return { ...job, id, firstSeenAt, isNew: !wasSeen };
  });

  // Hard age cutoff before anything costs a Claude call.
  const fresh = withIds.filter((job) => withinMaxAge(job, maxAge, now));
  const droppedOld = withIds.length - fresh.length;

  // Near-duplicate merge across sources.
  const merged = mergeNearDuplicates(fresh);

  if (persist) saveState(s);

  log.info(
    `pulled ${raw.length}, kept ${fresh.length} within ${maxAge}d (dropped ${droppedOld} stale), ` +
      `${merged.length} after near-dup merge, ${merged.filter((j) => j.isNew).length} new this run.`,
  );

  return { jobs: merged, state: s, stats: { pulled: raw.length, droppedOld, merged: merged.length } };
}

// Standalone: `npm run scout` — pull and print counts, no scoring, no persist.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { prefs, exists } = readPreferences();
  if (!exists) {
    console.error('[scout] inputs/preferences.md not found — run `npm run ingest` first.');
    process.exit(1);
  }
  runScout({ prefs, persist: false })
    .then(({ jobs }) => {
      for (const j of jobs.slice(0, 20)) {
        console.log(`  ${j.source.padEnd(10)} ${j.company} — ${j.title} (${j.location || 'n/a'})`);
      }
      console.log(`[scout] ${jobs.length} jobs after dedup.`);
    })
    .catch((e) => {
      console.error('[scout] failed:', e.message);
      process.exit(1);
    });
}
