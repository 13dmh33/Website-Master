#!/usr/bin/env node
/**
 * Merlin — the nightly advisor agent. Read-only, review-only: reads the
 * repo and business data, audits performance and cost, and produces a
 * dated report plus two paste-ready session prompts. Recommends; never
 * acts. See merlin/CLAUDE.md for the full design.
 *
 * Usage:
 *   node merlin/run.js              # full run: writes dated files + delivers the report
 *   node merlin/run.js --no-email   # writes dated files only, skips delivery
 *
 * Delivery picks its channel from the environment, both of which land in
 * 13dmh33@gmail.com:
 *   - GITHUB_TOKEN set (the CI case) → posts a GitHub issue, which GitHub emails.
 *     Needs no secrets, which is why CI uses it: ZOHO_EMAIL/ZOHO_APP_PASSWORD are
 *     not repo secrets, so every scheduled run failed before reaching Zoho at all.
 *   - Otherwise ZOHO_EMAIL/ZOHO_APP_PASSWORD (the local-Mac case) → SMTP, unchanged.
 *
 * Reads:  state.json, leads/*.json, leads-web/*.json, config/*.json,
 *         config/cost-log.json (via scripts/cost-tracker.js), git metadata.
 * Writes: merlin/reports/YYYY-MM-DD/{report.md,session-primary.md,session-light.md}
 *         and (unless --no-email) delivers the same content to 13dmh33@gmail.com.
 * Never writes to state.json, config/*.json, or any pipeline file — advisor only.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');

const { collectGitHealth } = require('./lib/git-health');
const { collectPipelineSnapshot } = require('./lib/pipeline-snapshot');
const { buildCostAudit } = require('./lib/cost-audit');
const { buildRanking } = require('./lib/ranking');
const { buildSessionPrompts } = require('./lib/session-prompt');
const { buildReport, today } = require('./lib/report');
const { sendMerlinReport } = require('./lib/mailer');
const { postMerlinIssue } = require('./lib/github-issue');
const { RECIPIENT } = require('./lib/report-body');
const { loadDecisions } = require('./lib/decisions');
const { collectRepoFacts } = require('./lib/repo-facts');

const REPORTS_DIR = path.join(__dirname, 'reports');
const LAST_FUNNEL_PATH = path.join(__dirname, 'last-funnel.json');

function loadPreviousFunnel() {
  try { return JSON.parse(fs.readFileSync(LAST_FUNNEL_PATH, 'utf8')); }
  catch { return null; } // first run ever — no previous snapshot to compare stalls against
}

function persistFunnel(funnel) {
  // Only the cumulative counts are needed for next run's stall detection.
  fs.writeFileSync(LAST_FUNNEL_PATH, JSON.stringify({
    date: today(),
    cumulativeReached: funnel.cumulativeReached,
  }, null, 2));
}

async function main() {
  const noEmail = process.argv.includes('--no-email');
  const date = today();

  console.log(`Merlin — nightly advisor run, ${date}`);
  console.log('─'.repeat(50));

  console.log('Collecting repo health...');
  const gitHealth = collectGitHealth();

  console.log('Collecting pipeline snapshot (funnel + Apollo)...');
  const previousFunnel = loadPreviousFunnel();
  const pipelineSnapshot = collectPipelineSnapshot({ previousFunnel });

  console.log('Running cost audit...');
  const costAudit = buildCostAudit({ funnel: pipelineSnapshot.funnel });

  console.log('Loading durable decisions + live repo facts...');
  const decisions = loadDecisions();
  const repoFacts = collectRepoFacts();

  console.log('Ranking candidate moves...');
  const ranking = buildRanking({ pipelineSnapshot, decisions, repoFacts });

  console.log('Generating session prompts...');
  const { primary, light, primaryQueue, lightQueue } = buildSessionPrompts({
    ranking, generatedFor: `${date} nightly run`,
  });

  console.log('Assembling report...');
  const report = buildReport({
    gitHealth, pipelineSnapshot, costAudit, ranking,
    primaryQueueHours: primaryQueue.totalHours, lightQueueHours: lightQueue.totalHours,
  });

  const outDir = path.join(REPORTS_DIR, date);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  fs.writeFileSync(path.join(outDir, 'session-primary.md'), primary);
  fs.writeFileSync(path.join(outDir, 'session-light.md'), light);
  console.log(`Wrote ${outDir}/{report.md,session-primary.md,session-light.md}`);

  // Persist this run's funnel so the NEXT run can detect stalled stages (10c).
  persistFunnel(pipelineSnapshot.funnel);

  console.log('\n' + '─'.repeat(50));
  console.log(`Recommendation: ${ranking.recommendation ? ranking.recommendation.label : 'none — empty candidate pool'}`);
  console.log(`Primary session: ~${primaryQueue.totalHours}h. Light alternate: ~${lightQueue.totalHours}h.`);

  if (noEmail) {
    console.log('\n--no-email — skipping delivery.');
    return;
  }

  await deliver({ report, primary, light, date });
}

/**
 * Delivers via whichever channel this environment can actually authenticate.
 * A delivery failure still sets exitCode 1 so the run goes red, but the report
 * files are already on disk by now and the workflow commits them regardless.
 */
async function deliver({ report, primary, light, date }) {
  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (githubToken) {
    console.log(`\nPosting report as a GitHub issue (GitHub emails it to ${RECIPIENT})...`);
    try {
      const { number, url } = await postMerlinIssue({
        report, primaryPrompt: primary, lightPrompt: light, date,
        token: githubToken,
        repo: process.env.GITHUB_REPOSITORY,
        runUrl: process.env.MERLIN_RUN_URL,
      });
      console.log(`Posted — issue #${number}: ${url}`);
    } catch (err) {
      console.error(`Issue delivery failed (report files are still written to disk): ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (process.env.ZOHO_EMAIL && process.env.ZOHO_APP_PASSWORD) {
    console.log(`\nSending report to ${RECIPIENT} via Zoho SMTP...`);
    try {
      const result = await sendMerlinReport({
        report, primaryPrompt: primary, lightPrompt: light, date,
        zohoEmail: process.env.ZOHO_EMAIL, zohoAppPassword: process.env.ZOHO_APP_PASSWORD,
      });
      console.log(`Sent — messageId: ${result.messageId}`);
    } catch (err) {
      console.error(`Email send failed (report files are still written to disk): ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error('\nNo delivery channel available — set GITHUB_TOKEN (issue) or '
    + 'ZOHO_EMAIL/ZOHO_APP_PASSWORD (SMTP). Report files are still written to disk.');
  process.exitCode = 1;
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
