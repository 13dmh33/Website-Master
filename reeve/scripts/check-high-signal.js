#!/usr/bin/env node
'use strict';

// check-high-signal.js — consumes Milly's high-signal post alerts
//
// Milly's analyst.js calls lib/reeve-handoff.js#notifyReeve() when a post gets
// unusually high profile visits (>2x weekly average) — these are written to
// milly/output/archive/high-signal-[weekOf].json for Reeve to pick up.
//
// Reeve has no automated outbound DM campaign to "increase volume" on (the DM
// agent only responds to inbound "stages" triggers), so the real action here
// is alerting Dave: a spike in profile traffic is a 3-day window where manual
// outreach (replies, story engagement, warm DMs) converts better than usual.
//
// Run after Milly's analyst.js in the same CI job (see
// .github/workflows/milly-weekly-analytics.yml) so the handoff happens
// within one pipeline run instead of needing a live webhook between two
// not-yet-deployed services.
//
// Usage:
//   node scripts/check-high-signal.js
//   node scripts/check-high-signal.js --dry-run   (don't send email, don't mark processed)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

const isDryRun = process.argv.includes('--dry-run');

// Milly and Reeve are sibling directories in the same monorepo checkout.
const ARCHIVE_DIR  = path.join(__dirname, '..', '..', 'milly', 'output', 'archive');
const LOOKBACK_DAYS = 14; // ignore stale entries from before this script existed / before a long gap

function loadHighSignalEntries() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];

  const cutoff = Date.now() - LOOKBACK_DAYS * 86400000;
  const entries = [];

  for (const file of fs.readdirSync(ARCHIVE_DIR)) {
    if (!file.startsWith('high-signal-') || !file.endsWith('.json')) continue;
    const filePath = path.join(ARCHIVE_DIR, file);

    let data;
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { continue; }

    if (!Array.isArray(data)) continue;

    data.forEach((entry, index) => {
      const detected = entry.detectedAt ? new Date(entry.detectedAt).getTime() : 0;
      if (!entry.reeveNotifiedAt && detected >= cutoff) {
        entries.push({ ...entry, _file: filePath, _index: index });
      }
    });
  }

  return entries;
}

function markNotified(entries) {
  const byFile = new Map();
  for (const entry of entries) {
    if (!byFile.has(entry._file)) byFile.set(entry._file, JSON.parse(fs.readFileSync(entry._file, 'utf8')));
    const data = byFile.get(entry._file);
    data[entry._index].reeveNotifiedAt = new Date().toISOString();
  }
  for (const [filePath, data] of byFile) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

function buildEmailBody(entries) {
  const lines = entries.map(e => {
    const windowEnd = new Date(new Date(e.detectedAt).getTime() + 3 * 86400000).toISOString().split('T')[0];
    return [
      `- Post: ${e.permalink || e.postId}`,
      `  Engagement: ${e.engagementRate}% | Profile visits: ${e.profileVisits}`,
      `  Outreach window: now through ${windowEnd}`,
    ].join('\n');
  });

  return [
    `Milly flagged ${entries.length} high-signal post(s) this week (profile visits over 2x the weekly average).`,
    '',
    `This is a good window for extra manual outreach — reply to comments, engage with new followers, send warm DMs. Reeve's DM agent only responds to inbound "stages" triggers, so capturing the spike is on you for now.`,
    '',
    ...lines,
  ].join('\n');
}

async function notifyDaveOfSignal(entries) {
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  const to   = process.env.DAVE_NOTIFY_EMAIL;

  if (!user || !pass || !to) {
    console.log('  (ZOHO_EMAIL / ZOHO_APP_PASSWORD / DAVE_NOTIFY_EMAIL not set — skipping email, logging only)');
    return false;
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user, pass },
  });

  await transport.sendMail({
    from:    `"Reeve" <${user}>`,
    to,
    subject: `Reeve: ${entries.length} high-signal post(s) — outreach window open`,
    text:    buildEmailBody(entries),
  });
  return true;
}

async function main() {
  console.log(`\nChecking for Milly high-signal handoffs${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  const entries = loadHighSignalEntries();

  if (!entries.length) {
    console.log('No new high-signal posts to act on.');
    return;
  }

  console.log(`Found ${entries.length} new high-signal post(s):`);
  console.log(buildEmailBody(entries));

  if (isDryRun) {
    console.log('\n[dry run — not emailing Dave or marking entries processed]');
    return;
  }

  let sent;
  try {
    sent = await notifyDaveOfSignal(entries);
  } catch (err) {
    console.error(`\n✗ Email failed: ${err.message} — leaving entries unmarked for retry next run.`);
    return;
  }

  if (!sent) {
    console.log('\nLeaving entries unmarked — they\'ll be retried once email credentials are set.');
    return;
  }

  console.log('\n✓ Dave notified.');
  markNotified(entries);
  console.log('✓ Entries marked processed.');
}

main().catch(err => {
  console.error('check-high-signal failed:', err.message);
  process.exit(1);
});
