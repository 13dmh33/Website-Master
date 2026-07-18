'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAlertBody, sendFailureAlert } = require('../notify-workflow-failure');

test('buildAlertBody — includes workflow, job, run URL, and commit', () => {
  const body = buildAlertBody({
    workflowName: 'Milly weekly pipeline', jobName: 'run-pipeline',
    runUrl: 'https://github.com/x/y/actions/runs/123', commitSha: 'abc123',
    timestamp: '2026-07-18T12:00:00Z',
  });
  assert.ok(body.includes('Milly weekly pipeline'));
  assert.ok(body.includes('run-pipeline'));
  assert.ok(body.includes('https://github.com/x/y/actions/runs/123'));
  assert.ok(body.includes('abc123'));
});

test('buildAlertBody — handles a missing commit SHA gracefully', () => {
  const body = buildAlertBody({
    workflowName: 'w', jobName: 'j', runUrl: 'u', commitSha: undefined, timestamp: 't',
  });
  assert.ok(body.includes('unknown'));
});

test('sendFailureAlert — fails loud (no crash) when Zoho creds are missing, never throws unhandled', async () => {
  await assert.rejects(
    () => sendFailureAlert({ zohoEmail: undefined, zohoAppPassword: undefined, workflowName: 'w', jobName: 'j', runUrl: 'u' }),
    /ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set/
  );
});
