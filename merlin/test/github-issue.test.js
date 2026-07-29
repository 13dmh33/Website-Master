'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  postMerlinIssue, buildIssueBody, buildIssueTitle,
  MAX_ISSUE_BODY, NOTIFY_HANDLE, LABEL,
} = require('../lib/github-issue');

function payload(overrides = {}) {
  return {
    report: '# Merlin report\n\nRecommendation: clear the backlog.',
    primaryPrompt: 'primary prompt body',
    lightPrompt: 'light prompt body',
    date: '2026-07-29',
    ...overrides,
  };
}

/** Minimal fetch double — records calls, replays a queue of responses. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const next = queue.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.json || {},
      text: async () => next.text || '',
    };
  };
  impl.calls = calls;
  return impl;
}

const OK = { status: 201, json: { number: 42, html_url: 'https://github.com/13dmh33/Website-Master/issues/42' } };

test('buildIssueBody — carries the report and both prompts', () => {
  const body = buildIssueBody(payload());
  assert.ok(body.includes('clear the backlog'));
  assert.ok(body.includes('primary prompt body'));
  assert.ok(body.includes('light prompt body'));
});

test('buildIssueBody — @-mentions Dave so the notification email fires regardless of watch settings', () => {
  const body = buildIssueBody(payload());
  assert.ok(body.startsWith(`@${NOTIFY_HANDLE}`));
});

test('buildIssueBody — states advisor-only, so the issue is never read as work done', () => {
  const body = buildIssueBody(payload());
  assert.ok(/never acts/i.test(body));
});

test('buildIssueBody — links the workflow run when one is supplied, and omits it otherwise', () => {
  const withRun = buildIssueBody(payload({ runUrl: 'https://github.com/o/r/actions/runs/1' }));
  assert.ok(withRun.includes('https://github.com/o/r/actions/runs/1'));
  assert.ok(!buildIssueBody(payload()).includes('Workflow run'));
});

test('buildIssueBody — truncates rather than exceeding GitHub\'s issue-body limit', () => {
  const body = buildIssueBody(payload({ report: 'x'.repeat(MAX_ISSUE_BODY * 2) }));
  assert.ok(body.length <= MAX_ISSUE_BODY);
  assert.ok(body.includes('Report truncated'));
  assert.ok(body.includes('merlin/reports/2026-07-29/'));
});

test('buildIssueTitle — dated, matching the email subject line', () => {
  assert.equal(buildIssueTitle('2026-07-29'), 'Merlin nightly report — 2026-07-29');
});

test('postMerlinIssue — posts to the repo from GITHUB_REPOSITORY, assigned and labeled', async () => {
  const f = fakeFetch([OK]);
  const result = await postMerlinIssue({ ...payload(), token: 't', repo: 'owner/name', fetchImpl: f });

  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/owner/name/issues');
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer t');
  assert.deepEqual(f.calls[0].body.assignees, [NOTIFY_HANDLE]);
  assert.deepEqual(f.calls[0].body.labels, [LABEL]);
  assert.deepEqual(result, { number: 42, url: 'https://github.com/13dmh33/Website-Master/issues/42' });
});

test('postMerlinIssue — a 422 on assignee/label metadata retries bare rather than losing the report', async () => {
  const f = fakeFetch([{ status: 422, text: 'Validation Failed' }, OK]);
  const result = await postMerlinIssue({ ...payload(), token: 't', repo: 'owner/name', fetchImpl: f });

  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.assignees, undefined);
  assert.equal(f.calls[1].body.labels, undefined);
  assert.ok(f.calls[1].body.body.includes('primary prompt body'));
  assert.equal(result.number, 42);
});

test('postMerlinIssue — surfaces a real API failure instead of reporting success', async () => {
  const f = fakeFetch([{ status: 403, text: 'Resource not accessible by integration' }]);
  await assert.rejects(
    postMerlinIssue({ ...payload(), token: 't', repo: 'owner/name', fetchImpl: f }),
    /403.*not accessible/s,
  );
});

test('postMerlinIssue — a 422 that repeats is reported, not swallowed', async () => {
  const f = fakeFetch([{ status: 422, text: 'Validation Failed' }, { status: 422, text: 'Validation Failed' }]);
  await assert.rejects(
    postMerlinIssue({ ...payload(), token: 't', repo: 'owner/name', fetchImpl: f }),
    /422/,
  );
});

test('postMerlinIssue — refuses to run without a token', async () => {
  await assert.rejects(
    postMerlinIssue({ ...payload(), token: '', fetchImpl: fakeFetch([OK]) }),
    /GITHUB_TOKEN must be set/,
  );
});

test('postMerlinIssue — falls back to the canonical repo when GITHUB_REPOSITORY is absent', async () => {
  const f = fakeFetch([OK]);
  await postMerlinIssue({ ...payload(), token: 't', repo: undefined, fetchImpl: f });
  assert.equal(f.calls[0].url, 'https://api.github.com/repos/13dmh33/Website-Master/issues');
});
