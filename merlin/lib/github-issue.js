'use strict';
/**
 * Delivery — posts the report + both session prompts as a GitHub issue, which
 * GitHub then emails to 13dmh33@gmail.com.
 *
 * Why this exists alongside lib/mailer.js: the nightly CI run had never once
 * succeeded, because ZOHO_EMAIL/ZOHO_APP_PASSWORD are not set as repo secrets
 * (see the 2026-07-29 run log — the mailer threw before opening a socket, Zoho
 * itself was never contacted). This channel authenticates with the GITHUB_TOKEN
 * that Actions injects automatically, so it needs no secret setup at all.
 *
 * Reaching the inbox does not depend on Dave's repo-watch settings: the issue is
 * authored by github-actions[bot] (not Dave, so self-action suppression doesn't
 * apply), assigned to him, and @-mentions him in the body. Assignment and
 * mentions both notify by email regardless of watch level.
 *
 * Same hard rule as the rest of Merlin: this writes an issue about its own
 * report and nothing else. It never comments on, labels, or closes anyone
 * else's issue or PR.
 */

const { buildEmailBody, RECIPIENT } = require('./report-body');

const DEFAULT_REPO = '13dmh33/Website-Master';
// GitHub rejects an issue body over 65536 characters. Today's report is ~16k,
// but it grows with the pipeline, so truncate rather than fail the delivery.
const MAX_ISSUE_BODY = 65536;
const NOTIFY_HANDLE = '13dmh33';
const LABEL = 'merlin-report';

function buildIssueTitle(date) {
  return `Merlin nightly report — ${date}`;
}

function truncationNotice(date) {
  return `\n\n---\n\n**Report truncated** — it exceeded GitHub's 65,536-character issue limit. `
    + `The complete version is committed at \`merlin/reports/${date}/\` and attached to the `
    + `workflow run as an artifact.\n`;
}

function buildIssueBody({ report, primaryPrompt, lightPrompt, date, runUrl }) {
  const header = `@${NOTIFY_HANDLE} — Merlin's nightly report for ${date}.\n\n`
    + `_Advisor only: Merlin recommends, it never acts. Nothing in this report has been done._\n\n---\n\n`;
  const footer = runUrl
    ? `\n---\n\n[Workflow run](${runUrl}) · files committed to \`merlin/reports/${date}/\`\n`
    : `\n---\n\nFiles committed to \`merlin/reports/${date}/\`\n`;

  const body = header + buildEmailBody({ report, primaryPrompt, lightPrompt }) + footer;
  if (body.length <= MAX_ISSUE_BODY) return body;

  const notice = truncationNotice(date);
  return body.slice(0, MAX_ISSUE_BODY - notice.length) + notice;
}

/**
 * Posts the issue. `token` is the Actions-injected GITHUB_TOKEN; `repo` is
 * "owner/name" (GITHUB_REPOSITORY). `fetchImpl` is injectable for tests.
 */
async function postMerlinIssue({ report, primaryPrompt, lightPrompt, date, runUrl, token, repo, fetchImpl }) {
  if (!token) {
    throw new Error('GITHUB_TOKEN must be set to post the Merlin report as an issue');
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const target = repo || DEFAULT_REPO;
  const url = `https://api.github.com/repos/${target}/issues`;
  const title = buildIssueTitle(date);
  const body = buildIssueBody({ report, primaryPrompt, lightPrompt, date, runUrl });

  const post = (payload) => doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let res = await post({ title, body, assignees: [NOTIFY_HANDLE], labels: [LABEL] });

  // A repo without the label, or with assignment restrictions, answers 422.
  // The report matters more than its tidy metadata — retry bare.
  if (res.status === 422) {
    res = await post({ title, body });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub issue creation failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const issue = await res.json();
  return { number: issue.number, url: issue.html_url };
}

module.exports = {
  postMerlinIssue,
  buildIssueBody,
  buildIssueTitle,
  DEFAULT_REPO,
  MAX_ISSUE_BODY,
  NOTIFY_HANDLE,
  LABEL,
  RECIPIENT,
};
