#!/usr/bin/env node
/**
 * Cron failure alerting (task 8) — sends a short email via Zoho SMTP when a
 * scheduled GitHub Actions workflow fails. Minimal on purpose: which job,
 * when, exit status, and a link to the full run log — no dashboard, no new
 * service, matching the task's explicit scope.
 *
 * Wired as a final `if: failure()` step in each scheduled workflow (see
 * .github/workflows/*.yml) — GitHub Actions only runs that step when an
 * earlier step in the same job has already failed, so this script only
 * ever fires on a real failure.
 *
 * Usage (env-var driven, matches how GitHub Actions passes context):
 *   WORKFLOW_NAME="Milly weekly pipeline" JOB_NAME=run-pipeline \
 *   RUN_URL="https://github.com/.../actions/runs/123" \
 *   COMMIT_SHA=abc123 \
 *   ZOHO_EMAIL=... ZOHO_APP_PASSWORD=... \
 *   node scripts/notify-workflow-failure.js
 *
 * NOTIFY_TO defaults to ZOHO_EMAIL (i.e. Dave's own inbox) if unset.
 */

const nodemailer = require('nodemailer');

function getZohoTransport(zohoEmail, zohoAppPassword) {
  if (!zohoEmail || !zohoAppPassword) {
    throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set to send a failure alert.');
  }
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: zohoEmail, pass: zohoAppPassword },
  });
}

function buildAlertBody({ workflowName, jobName, runUrl, commitSha, timestamp }) {
  return [
    `Workflow: ${workflowName}`,
    `Job:      ${jobName}`,
    `When:     ${timestamp}`,
    `Commit:   ${commitSha || 'unknown'}`,
    `Status:   failed (non-zero exit on an earlier step)`,
    '',
    `Full run log: ${runUrl}`,
    '',
    'This is a minimal failure alert — no dashboard, no retry, no auto-fix.',
    'Check the run log above for the actual error.',
  ].join('\n');
}

async function sendFailureAlert({ zohoEmail, zohoAppPassword, notifyTo, workflowName, jobName, runUrl, commitSha }) {
  const transport = getZohoTransport(zohoEmail, zohoAppPassword);
  const timestamp = new Date().toISOString();
  const body = buildAlertBody({ workflowName, jobName, runUrl, commitSha, timestamp });
  return transport.sendMail({
    from: zohoEmail,
    to: notifyTo || zohoEmail,
    subject: `[ALERT] ${workflowName} failed — ${jobName}`,
    text: body,
  });
}

async function main() {
  const {
    ZOHO_EMAIL, ZOHO_APP_PASSWORD, NOTIFY_TO,
    WORKFLOW_NAME, JOB_NAME, RUN_URL, COMMIT_SHA,
  } = process.env;

  if (!WORKFLOW_NAME || !JOB_NAME || !RUN_URL) {
    console.error('WORKFLOW_NAME, JOB_NAME, and RUN_URL are required.');
    process.exit(1);
  }

  try {
    const result = await sendFailureAlert({
      zohoEmail: ZOHO_EMAIL, zohoAppPassword: ZOHO_APP_PASSWORD, notifyTo: NOTIFY_TO,
      workflowName: WORKFLOW_NAME, jobName: JOB_NAME, runUrl: RUN_URL, commitSha: COMMIT_SHA,
    });
    console.log(`Failure alert sent — messageId: ${result.messageId}`);
  } catch (err) {
    // Never let the notifier itself fail the job further — log and exit 0
    // so it doesn't mask the original failure with a second one.
    console.error(`Failed to send failure alert: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildAlertBody, sendFailureAlert, getZohoTransport };
