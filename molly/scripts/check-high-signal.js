#!/usr/bin/env node
'use strict';

// check-high-signal.js — consumes Molly's own high-signal post alerts.
//
// Mirrors reeve/scripts/check-high-signal.js's pattern exactly (same repo,
// sibling system) — the difference is Molly's "handoff" target is just Dave
// himself, not a separate product, since Trevo is his own business. analyst.js
// calls lib/high-signal.js#flagHighSignal() when a post gets unusually high
// profile visits (>2x weekly average) — these are written to
// molly/output/archive/high-signal-[weekOf].json for this script to pick up.
//
// Run after analyst.js in the same CI job (see
// .github/workflows/molly-weekly-analytics.yml) — same reasoning as Reeve's:
// no live webhook exists between "a spike happened" and "Dave got told."
//
// Usage:
//   node scripts/check-high-signal.js
//   node scripts/check-high-signal.js --dry-run   (don't send email, don't mark processed)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');

const isDryRun = process.argv.includes('--dry-run');

const ARCHIVE_DIR   = path.join(__dirname, '..', 'output', 'archive');
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
      if (!entry.daveNotifiedAt && detected >= cutoff) {
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
    data[entry._index].daveNotifiedAt = new Date().toISOString();
  }
  for (const [filePath, data] of byFile) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

function buildEmailBody(entries) {
  const lines = entries.map(e => {
    const windowEnd = new Date(new Date(e.detectedAt).getTime() + 3 * 86400000).toISOString().split('T')[0];
    return [
      `- Post: ${e.permalink || e.postId} (${e.format || 'unknown format'})`,
      `  Engagement: ${e.engagementRate}% | Profile visits: ${e.profileVisits}`,
      `  Outreach window: now through ${windowEnd}`,
    ].join('\n');
  });

  return [
    `Molly flagged ${entries.length} high-signal post(s) this week (profile visits over 2x the weekly average).`,
    '',
    `This is a good window for extra manual outreach — reply to comments, engage with new followers, check DMs. There is no automated welcome-DM flow yet (the full Instagram DM catcher spec in molly/CLAUDE.md needs a live @trevoadvisors account, Meta App messaging review, and a Supabase project — none of which exist yet), so capturing the spike is on you for now.`,
    '',
    ...lines,
  ].join('\n');
}

async function notifyDave(entries) {
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
    from:    `"Molly" <${user}>`,
    to,
    subject: `Molly: ${entries.length} high-signal post(s) — outreach window open`,
    text:    buildEmailBody(entries),
  });
  return true;
}

async function main() {
  console.log(`\nChecking for Molly high-signal posts${isDryRun ? ' [DRY RUN]' : ''}...`);
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
    sent = await notifyDave(entries);
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
