#!/usr/bin/env node
/**
 * Cron Setup Helper — prints the exact cron lines needed on Mac
 *
 * Run on Mac: node scripts/setup-cron.js
 * Then:       crontab -e  and paste the output
 */

const { execSync } = require('child_process');
const path         = require('path');
const os           = require('os');

const ROOT = path.resolve(__dirname, '..');

function detect(cmd) {
  try { return execSync(`which ${cmd}`, { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

const nodePath = detect('node') || '/usr/local/bin/node';
const homeDir  = os.homedir();

// Try to guess the repo path (works if running from the repo)
const repoPath = ROOT;

const sep  = '─'.repeat(60);
const sep2 = '━'.repeat(60);

console.log('');
console.log(sep2);
console.log('  Trevo Advisors — Cron Setup');
console.log(sep2);
console.log('');
console.log(`  Node:  ${nodePath}`);
console.log(`  Repo:  ${repoPath}`);
console.log(`  Home:  ${homeDir}`);
console.log('');
console.log('  Run:  crontab -e');
console.log('  Then paste the lines below (remove the # prefix):');
console.log('');
console.log(sep);

const jobs = [
  {
    name:    'Morning Report (7am daily)',
    cron:    `0 7 * * *`,
    script:  'scripts/reporter.js',
    log:     `${homeDir}/.trevo-logs/reporter-cron.log`,
    note:    'Sends summary email to REPORT_TO_EMAIL'
  },
  {
    name:    'Drip Campaign (9am daily)',
    cron:    `0 9 * * *`,
    script:  'scripts/drip.js --force',
    log:     `${homeDir}/.trevo-logs/drip-cron.log`,
    note:    'Sends due follow-ups. Runs after reporter.'
  },
  {
    name:    'Email Reply Poller (every 15 min)',
    cron:    `*/15 * * * *`,
    script:  'scripts/poller.js',
    log:     `${homeDir}/.trevo-logs/poller-cron.log`,
    note:    'Checks Zoho inbox for replies. Requires: npm install imapflow'
  },
  {
    name:    'Mobile Agent (every 30 min)',
    cron:    `*/30 * * * *`,
    script:  'scripts/mobile.js',
    log:     `${homeDir}/.trevo-logs/mobile-cron.log`,
    note:    'Auto-replies to positive leads. Safe to run often — skips if nothing to do.'
  },
];

for (const job of jobs) {
  const line = `${job.cron} cd "${repoPath}" && ${nodePath} ${job.script} >> "${job.log}" 2>&1`;
  console.log('');
  console.log(`  # ${job.name}`);
  console.log(`  # ${job.note}`);
  console.log(`  ${line}`);
}

console.log('');
console.log(sep);
console.log('');
console.log('  Also needed — create the log directory:');
console.log(`  mkdir -p ${homeDir}/.trevo-logs`);
console.log('');
console.log('  Webhook (run manually in a terminal tab, not cron):');
console.log(`  node ${repoPath}/scripts/webhook.js`);
console.log(`  # Then in another tab: ngrok http 3000`);
console.log('');
console.log('  Verify cron is working:');
console.log(`  tail -f ${homeDir}/.trevo-logs/reporter-cron.log`);
console.log('');
console.log(sep2);
console.log('');
