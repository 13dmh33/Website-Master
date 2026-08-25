#!/usr/bin/env node
/**
 * Merlin — the nightly advisor agent. Read-only, review-only: reads the
 * repo and business data, audits performance and cost, and produces a
 * dated report plus two paste-ready session prompts. Recommends; never
 * acts. See merlin/CLAUDE.md for the full design.
 *
 * Usage:
 *   node merlin/run.js              # full run: writes dated files + emails the report
 *   node merlin/run.js --no-email   # writes dated files only, skips the Zoho send
 *   node merlin/run.js --reeve      # also collect Reeve's business metrics (strategy/lib/
 *                                   # reeve-metrics.js) and include Reeve-sourced candidates
 *                                   # in the same ranked backlog as Trevo's. Default (no flag)
 *                                   # stays Trevo-only, unchanged, so the existing nightly
 *                                   # cron is unaffected.
 *
 * Reads:  state.json, leads/*.json, leads-web/*.json, config/*.json,
 *         config/cost-log.json (via scripts/cost-tracker.js), git metadata.
 * Writes: merlin/reports/YYYY-MM-DD/{report.md,session-primary.md,session-light.md}
 *         and (unless --no-email) sends the same content to 13dmh33@gmail.com.
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
const { loadDecisions } = require('./lib/decisions');
const { collectRepoFacts } = require('./lib/repo-facts');
const { loadFeedback } = require('./lib/feedback');
const { collectReeveSnapshot } = require('./lib/reeve-snapshot');

const REPORTS_DIR = path.join(__dirname, 'reports');
const LAST_FUNNEL_PATH = path.join(__dirname, 'last-funnel.json');

function loadPreviousFunnel() {
  try {
    const prev = JSON.parse(fs.readFileSync(LAST_FUNNEL_PATH, 'utf8'));
    // Stall detection asks "has anything moved since the last run". Comparing
    // against a snapshot taken earlier the SAME day answers a different
    // question — of course nothing advanced in twenty minutes — and on
    // 2026-08-13 that promoted a false "frozen stage" alarm to the top
    // recommendation, contradicting both the same morning's report ("Stalled
    // stages: none") and the standing backlog-is-arithmetic decision. The date
    // was already being persisted; it just was never read back.
    if (prev && prev.date === today()) return null;
    return prev;
  } catch {
    return null; // first run ever — no previous snapshot to compare stalls against
  }
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
  const includeReeve = process.argv.includes('--reeve');
  const date = today();

  console.log(`Merlin — nightly advisor run, ${date}`);
  console.log('─'.repeat(50));

  console.log('Collecting repo health...');
  const gitHealth = collectGitHealth();

  console.log('Collecting pipeline snapshot (funnel + Apollo)...');
  const previousFunnel = loadPreviousFunnel();
  const pipelineSnapshot = collectPipelineSnapshot({ previousFunnel });

  let reeveSnapshot = null;
  if (includeReeve) {
    console.log('Collecting Reeve snapshot (business metrics + alerts)...');
    reeveSnapshot = collectReeveSnapshot();
  }

  console.log('Running cost audit...');
  const costAudit = buildCostAudit({ funnel: pipelineSnapshot.funnel });

  console.log('Loading durable decisions + live repo facts...');
  const decisions = loadDecisions();
  const repoFacts = collectRepoFacts();
  const feedback = loadFeedback();

  console.log('Ranking candidate moves...');
  const ranking = buildRanking({ pipelineSnapshot, decisions, repoFacts, feedback, reeveSnapshot });

  console.log('Generating session prompts...');
  const { primary, light, primaryQueue, lightQueue } = buildSessionPrompts({
    ranking, generatedFor: `${date} nightly run`,
  });

  console.log('Assembling report...');
  const report = buildReport({
    gitHealth, pipelineSnapshot, costAudit, ranking, reeveSnapshot, feedback,
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
    console.log('\n--no-email — skipping Zoho send.');
    return;
  }

  console.log('\nSending report to 13dmh33@gmail.com via Zoho SMTP...');
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
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
