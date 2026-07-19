'use strict';
/**
 * Live repo-fact resolution (Task 10a). Merlin's static candidate list is a
 * standing backlog; some items get DONE between runs, on main or on an
 * unmerged branch. Without this, Merlin keeps recommending work that already
 * exists — the exact "confidently wrong advice" failure this fixes (it once
 * reported the poller email-reply fix as missing when it existed unmerged,
 * and re-recommended a merge that had already landed).
 *
 * For each auto-resolvable candidate id, a predicate checks real repo state —
 * config files on disk AND whether a marker path exists on ANY branch (local
 * or origin), not just the checked-out one. Everything is injectable (exec +
 * readConfig) so the logic is testable without a live repo.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function realExec(cmd) {
  try { return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
  catch { return ''; }
}

function realReadFile(rel) {
  try { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }
  catch { return null; }
}

function realReadJson(rel) {
  const raw = realReadFile(rel);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Does a path exist on ANY ref (all local heads + all remotes)? Uses
 * `git rev-list --all` scoped to the path — non-empty means at least one
 * commit on some branch touched it. This is the "read all branches, not just
 * main" check (Task 10a): a candidate to BUILD something is stale if that
 * thing already exists anywhere.
 */
function pathExistsOnAnyBranch(relPath, exec = realExec) {
  const out = exec(`git rev-list --all --max-count=1 -- "${relPath}"`);
  return typeof out === 'string' && out.trim().length > 0;
}

/**
 * Resolution predicates keyed by candidate id. Each returns
 * { resolved: bool, note: string } given live repo state. Only ids that are
 * genuinely machine-verifiable appear here; everything else is left for the
 * ranker/decisions to handle.
 */
function buildResolvers({ exec = realExec, readJson = realReadJson, readFile = realReadFile } = {}) {
  return {
    revert_elevated_daily_limits: () => {
      const checker = readJson('config/checker-config.json');
      const diagnoser = readJson('config/diagnoser-config.json');
      const c = checker && checker.daily_limit;
      const d = diagnoser && diagnoser.daily_limit;
      const resolved = (c !== undefined && c <= 30) && (d !== undefined && d <= 30);
      return {
        resolved,
        note: resolved
          ? `Already done: checker daily_limit=${c}, diagnoser daily_limit=${d} (both at/under the documented normal of 30).`
          : `Still elevated: checker daily_limit=${c}, diagnoser daily_limit=${d}.`,
      };
    },

    merge_nora_and_funnel_metrics: () => {
      const noraOnMain = readFile('nora/CLAUDE.md') !== null;
      const funnelOnMain = readFile('scripts/lib/funnel.js') !== null;
      const noraAnywhere = noraOnMain || pathExistsOnAnyBranch('nora/CLAUDE.md', exec);
      const funnelAnywhere = funnelOnMain || pathExistsOnAnyBranch('scripts/lib/funnel.js', exec);
      const resolved = noraOnMain && funnelOnMain;
      return {
        resolved,
        note: resolved
          ? 'Already done: both nora/ and scripts/lib/funnel.js are present on the checked-out main.'
          : `Not fully merged to main (nora present on main: ${noraOnMain}, funnel present on main: ${funnelOnMain}; exists on some branch — nora: ${noraAnywhere}, funnel: ${funnelAnywhere}).`,
      };
    },

    fix_poller_email_reply_gap: () => {
      const poller = readFile('scripts/poller.js');
      // The fix wires reply-classifier.js into poller.js; its presence is the marker.
      const resolved = poller !== null && /reply-classifier/.test(poller);
      return {
        resolved,
        note: resolved
          ? 'Already done: scripts/poller.js references reply-classifier (email replies are now classified into state.json).'
          : 'Not done on main: scripts/poller.js does not reference reply-classifier.',
      };
    },
  };
}

/**
 * collectRepoFacts() — resolves every auto-resolvable candidate id against
 * live repo state. Returns { resolvedIds: Map<id, note>, resolver } so the
 * ranker can drop resolved candidates and the report can explain why.
 */
function collectRepoFacts(deps = {}) {
  const resolvers = buildResolvers(deps);
  const resolvedIds = new Map();
  for (const [id, fn] of Object.entries(resolvers)) {
    const { resolved, note } = fn();
    if (resolved) resolvedIds.set(id, note);
  }
  return {
    resolvedIds,
    isResolved: (id) => resolvedIds.has(id),
    noteFor: (id) => resolvedIds.get(id) || null,
    pathExistsOnAnyBranch: (p) => pathExistsOnAnyBranch(p, deps.exec || realExec),
  };
}

module.exports = { collectRepoFacts, buildResolvers, pathExistsOnAnyBranch };
