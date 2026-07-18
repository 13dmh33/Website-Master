'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { daysSince, collectGitHealth } = require('../lib/git-health');

test('daysSince — computes whole days between now and a past date', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(daysSince(tenDaysAgo), 10);
});

test('daysSince — returns null for missing/invalid input', () => {
  assert.equal(daysSince(null), null);
  assert.equal(daysSince('not a date'), null);
});

function fakeExec(responses) {
  return (cmd) => {
    for (const [pattern, output] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return output;
    }
    throw new Error(`fakeExec: no canned response for "${cmd}"`);
  };
}

test('collectGitHealth — flags a stale branch and an unpushed branch correctly', () => {
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const freshDate = new Date().toISOString();
  const exec = fakeExec({
    'for-each-ref': `stale-branch|${oldDate}\nfresh-branch|${freshDate}`,
    'rev-list --count origin/stale-branch..stale-branch': '3',
    'rev-list --count stale-branch..origin/stale-branch': '0',
    'rev-parse --verify origin/stale-branch': 'abc123',
    'rev-list --count origin/fresh-branch..fresh-branch': '0',
    'rev-list --count fresh-branch..origin/fresh-branch': '0',
    'rev-parse --verify origin/fresh-branch': 'def456',
    'merge-base --is-ancestor origin/stale-branch origin/main': 'no',
    'merge-base --is-ancestor origin/fresh-branch origin/main': 'yes',
    'rev-list --count origin/main..main': '0',
    'rev-list --count main..origin/main': '0',
  });
  // untrackedTopLevelDirs does its own fs.readdirSync + exec calls — stub minimal wc -l response
  const execWithLsFiles = (cmd) => {
    if (cmd.includes('ls-files')) return '5';
    return exec(cmd);
  };

  const result = collectGitHealth(execWithLsFiles);
  const stale = result.branches.find(b => b.name === 'stale-branch');
  const fresh = result.branches.find(b => b.name === 'fresh-branch');

  assert.equal(stale.stale, true);
  assert.equal(stale.unpushed, true);
  assert.equal(stale.mergedIntoOriginMain, false);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.unpushed, false);
  assert.equal(fresh.mergedIntoOriginMain, true);
});

test('collectGitHealth — treats a branch with no origin tracking ref as unpushed, not fatal', () => {
  const exec = (cmd) => {
    if (cmd.includes('for-each-ref')) return `local-only|${new Date().toISOString()}`;
    if (cmd.includes('rev-parse --verify')) throw new Error('unknown revision');
    if (cmd.includes('rev-list')) throw new Error('unknown revision');
    if (cmd.includes('merge-base')) return 'no';
    if (cmd.includes('ls-files')) return '0';
    throw new Error(`unexpected: ${cmd}`);
  };
  const result = collectGitHealth(exec);
  const branch = result.branches.find(b => b.name === 'local-only');
  assert.equal(branch.existsOnOrigin, false);
  assert.equal(branch.unpushed, true);
});

test('collectGitHealth — never throws even when every git call fails (e.g. not a git repo)', () => {
  const failingExec = () => { throw new Error('not a git repository'); };
  assert.doesNotThrow(() => collectGitHealth(failingExec));
});

test('collectGitHealth — live smoke test against the real repo, structural only', () => {
  const result = collectGitHealth();
  assert.ok(Array.isArray(result.branches));
  assert.ok(result.branches.some(b => b.name === 'feature/merlin-advisor'));
  assert.ok(typeof result.mainDivergence.ahead === 'number' || result.mainDivergence.ahead === null);
});
