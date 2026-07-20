'use strict';
/**
 * Repo health data collection — read-only git metadata. Every function
 * takes an injectable `exec` (defaults to a real synchronous git call) so
 * the parsing/shaping logic is testable without a real repo.
 */

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function realExec(cmd) {
  // stderr: 'pipe' (not the default 'inherit') so a benign git failure — e.g. a
  // local branch with no matching origin/ ref — doesn't leak "fatal:" lines to
  // the process stderr. safeExec already turns the thrown error into a null;
  // this just keeps the (CI) log clean so real errors stay visible.
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function safeExec(cmd, exec) {
  try {
    return exec(cmd).trim();
  } catch (err) {
    return null; // git command failed (e.g. no origin tracking ref) — caller treats as unknown, not fatal
  }
}

/** Days between now and an ISO-ish git date string. */
function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function listLocalBranches(exec) {
  const raw = safeExec(`git for-each-ref --format="%(refname:short)|%(committerdate:iso-strict)" refs/heads/`, exec);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [name, date] = line.split('|');
    return { name, lastCommitAt: date, staleDays: daysSince(date) };
  });
}

function branchAheadBehindOrigin(branchName, exec) {
  const ahead = safeExec(`git rev-list --count origin/${branchName}..${branchName}`, exec);
  const behind = safeExec(`git rev-list --count ${branchName}..origin/${branchName}`, exec);
  const existsOnOrigin = safeExec(`git rev-parse --verify origin/${branchName}`, exec) !== null;
  return {
    existsOnOrigin,
    ahead: ahead !== null ? parseInt(ahead, 10) : null,
    behind: behind !== null ? parseInt(behind, 10) : null,
  };
}

function isMergedIntoOriginMain(branchName, exec) {
  if (branchName === 'main') return true;
  const result = safeExec(`git merge-base --is-ancestor ${branchName} origin/main && echo yes || echo no`, exec);
  return result === 'yes';
}

function mainDivergenceFromOrigin(exec) {
  const ahead = safeExec('git rev-list --count origin/main..main', exec);
  const behind = safeExec('git rev-list --count main..origin/main', exec);
  return {
    ahead: ahead !== null ? parseInt(ahead, 10) : null,
    behind: behind !== null ? parseInt(behind, 10) : null,
  };
}

/** Top-level directories present on disk but not tracked in git at all (e.g. leads-web/). */
function untrackedTopLevelDirs(exec) {
  const fs = require('fs');
  const allDirs = fs.readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map(e => e.name);
  const untracked = [];
  for (const dir of allDirs) {
    const trackedCount = safeExec(`git ls-files ${dir}/ | wc -l`, exec);
    if (trackedCount !== null && parseInt(trackedCount, 10) === 0) {
      untracked.push(dir);
    }
  }
  return untracked;
}

const STALE_THRESHOLD_DAYS = 14;

/**
 * collectGitHealth(exec = realExec) — the one function callers use.
 * Returns { branches, mainDivergence, untrackedDirs }.
 */
function collectGitHealth(exec = realExec) {
  const branchNames = listLocalBranches(exec);
  const branches = branchNames.map(b => {
    const remote = branchAheadBehindOrigin(b.name, exec);
    const merged = remote.existsOnOrigin ? isMergedIntoOriginMain(`origin/${b.name}`, exec) : false;
    return {
      ...b,
      ...remote,
      mergedIntoOriginMain: merged,
      stale: b.staleDays !== null && b.staleDays >= STALE_THRESHOLD_DAYS,
      unpushed: remote.existsOnOrigin === false || (remote.ahead || 0) > 0,
    };
  });

  return {
    branches,
    mainDivergence: mainDivergenceFromOrigin(exec),
    untrackedDirs: untrackedTopLevelDirs(exec),
  };
}

module.exports = { collectGitHealth, listLocalBranches, branchAheadBehindOrigin, mainDivergenceFromOrigin, untrackedTopLevelDirs, daysSince, STALE_THRESHOLD_DAYS };
