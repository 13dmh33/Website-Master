#!/usr/bin/env node
'use strict';

// review-drafts.js — Dave's review queue for pitcher, follower, and reporter drafts
//
// Shows each pending draft, lets Dave approve or reject, then sends approved ones.
// Sending requires ZOHO_EMAIL + ZOHO_APP_PASSWORD in .env (for reports/followups)
// or a manual override if the organizer email isn't on file (for pitches).
//
// Usage:
//   node scripts/review-drafts.js                  (all pending drafts)
//   node scripts/review-drafts.js --type pitch     (pitches only)
//   node scripts/review-drafts.js --type followup  (follow-ups only)
//   node scripts/review-drafts.js --type report    (client reports only)
//   node scripts/review-drafts.js --list           (list all drafts, no interaction)
//   node scripts/review-drafts.js --dry-run        (show what would send, don't send)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline  = require('readline');
const fs        = require('fs');
const path      = require('path');
const https     = require('https');
const nodemailer = require('nodemailer');

const args     = process.argv.slice(2);
const typeFilter = (() => { const i = args.indexOf('--type'); return i !== -1 ? args[i + 1] : null; })();
const isList   = args.includes('--list');
const isDryRun = args.includes('--dry-run');

const DRAFTS_DIR = path.join(__dirname, '..', 'output', 'pitches');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

// ── Email sender ──────────────────────────────────────────────────────────────

let _transport = null;
function getTransport() {
  if (_transport) return _transport;
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) return null;
  _transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user, pass }
  });
  return _transport;
}

async function sendEmail(to, subject, body, fromName = 'Dave | Reeve') {
  const transport = getTransport();
  if (!transport) {
    throw new Error('ZOHO_EMAIL / ZOHO_APP_PASSWORD not set — cannot send email');
  }
  const info = await transport.sendMail({
    from:    `"${fromName}" <${process.env.ZOHO_EMAIL}>`,
    to,
    subject,
    text:    body,
  });
  return info.messageId;
}

// ── Draft loading ─────────────────────────────────────────────────────────────

function loadDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8'));
        return { ...d, _file: path.join(DRAFTS_DIR, f) };
      } catch { return null; }
    })
    .filter(Boolean);
}

function saveDraft(draft) {
  const { _file, ...data } = draft;
  fs.writeFileSync(_file, JSON.stringify(data, null, 2), 'utf8');
}

function getPendingDrafts() {
  const all = loadDrafts().filter(d => d.status === 'draft');
  if (typeFilter) return all.filter(d => d.type === typeFilter);
  return all;
}

// ── List mode ─────────────────────────────────────────────────────────────────

function printList() {
  const all    = loadDrafts();
  const byType = { pitch: [], followup: [], report: [] };

  for (const d of all) {
    if (byType[d.type]) byType[d.type].push(d);
  }

  const typeLabel = { pitch: 'Pitches', followup: 'Follow-ups', report: 'Reports' };

  console.log('\n═══ Reeve Draft Queue ═══\n');

  for (const [type, drafts] of Object.entries(byType)) {
    const pending = drafts.filter(d => d.status === 'draft');
    const sent    = drafts.filter(d => d.status === 'sent');
    const rejected = drafts.filter(d => d.status === 'rejected');
    console.log(`${typeLabel[type]}: ${pending.length} pending · ${sent.length} sent · ${rejected.length} rejected`);

    for (const d of pending) {
      const to = d.to || '(no recipient — enter on review)';
      console.log(`  [draft] ${d.id}`);
      console.log(`    To: ${to}`);
      console.log(`    Subject: ${d.subject}`);
      if (d.cfpDeadline) console.log(`    CFP deadline: ${d.cfpDeadline}`);
    }
  }

  console.log('\n═'.repeat(25));
}

// ── Interactive review ─────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function printDraft(draft, index, total) {
  const typeLabels = { pitch: 'PITCH', followup: 'FOLLOW-UP', report: 'REPORT' };
  const label = typeLabels[draft.type] || draft.type.toUpperCase();

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${label} ${index}/${total} — ${draft.id}`);
  console.log('═'.repeat(60));

  if (draft.type === 'pitch' || draft.type === 'followup') {
    console.log(`  Conference:  ${draft.conference || '—'}`);
    if (draft.cfpDeadline) console.log(`  CFP deadline: ${draft.cfpDeadline}`);
    if (draft.opportunityUrl) console.log(`  CFP URL:     ${draft.opportunityUrl}`);
    console.log(`  Client:      ${draft.clientName}`);
    console.log(`  To:          ${draft.to || '⚠  NOT SET — enter organizer email below'}`);
  }

  if (draft.type === 'report') {
    console.log(`  Client:      ${draft.clientName}`);
    console.log(`  To:          ${draft.to}`);
  }

  console.log('─'.repeat(60));
  console.log(`  Subject: ${draft.subject}`);
  console.log('─'.repeat(60));
  console.log(draft.body);
  console.log('─'.repeat(60));
}

async function reviewDrafts(pending) {
  let approved = 0, rejected = 0, skipped = 0, errors = 0;

  for (let i = 0; i < pending.length; i++) {
    const draft = pending[i];
    printDraft(draft, i + 1, pending.length);

    const answer = await ask('\n  [a] Approve & send  [r] Reject  [s] Skip  [q] Quit: ');
    const choice = answer.trim().toLowerCase();

    if (choice === 'q') {
      console.log('\nQuitting — remaining drafts untouched.');
      break;
    }

    if (choice === 's') {
      skipped++;
      continue;
    }

    if (choice === 'r') {
      const reason = await ask('  Rejection note (optional): ');
      draft.status        = 'rejected';
      draft.reviewedAt    = new Date().toISOString();
      draft.rejectionNote = reason.trim() || null;
      saveDraft(draft);
      console.log('  ✓ Marked rejected.');
      rejected++;
      continue;
    }

    if (choice === 'a') {
      // Pitches need an organizer email if not already on file
      if ((draft.type === 'pitch' || draft.type === 'followup') && !draft.to) {
        const email = await ask('  Enter organizer email address: ');
        if (!email.trim()) {
          console.log('  ✗ Email required to send — skipping.');
          skipped++;
          continue;
        }
        draft.to = email.trim();
      }

      draft.status     = 'approved';
      draft.reviewedAt = new Date().toISOString();
      saveDraft(draft);

      if (isDryRun) {
        console.log(`  [DRY RUN] Would send to: ${draft.to}`);
        approved++;
        continue;
      }

      try {
        const msgId = await sendEmail(draft.to, draft.subject, draft.body);
        draft.status = 'sent';
        draft.sentAt = new Date().toISOString();
        draft.sendRef = msgId;
        saveDraft(draft);
        console.log(`  ✓ Sent to ${draft.to}`);
        approved++;
      } catch (err) {
        console.log(`  ✗ Send failed: ${err.message}`);
        console.log('  Draft marked approved — retry manually or resend later.');
        errors++;
      }

      continue;
    }

    // Unrecognized input — re-prompt (count as skip)
    console.log('  Unrecognized — skipping.');
    skipped++;
  }

  rl.close();

  console.log('\n' + '═'.repeat(60));
  console.log('Review complete.');
  console.log(`  Sent:     ${approved}${isDryRun ? ' (dry run)' : ''}`);
  console.log(`  Rejected: ${rejected}`);
  console.log(`  Skipped:  ${skipped}`);
  if (errors > 0) console.log(`  Errors:   ${errors}`);
  console.log('═'.repeat(60));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isList) {
    printList();
    return;
  }

  const pending = getPendingDrafts();

  if (!pending.length) {
    const filter = typeFilter ? ` ${typeFilter} ` : ' ';
    console.log(`No pending${filter}drafts in the queue.`);
    console.log('Run the relevant agent to generate drafts:');
    console.log('  node agents/pitcher.js');
    console.log('  node agents/follower.js');
    console.log('  node agents/reporter.js');
    return;
  }

  const filter = typeFilter ? ` (${typeFilter} only)` : '';
  console.log(`\n${pending.length} pending draft(s) to review${filter}${isDryRun ? ' [DRY RUN]' : ''}.`);

  if (!isDryRun && !getTransport()) {
    console.log('\n⚠  ZOHO_EMAIL / ZOHO_APP_PASSWORD not set — emails cannot be sent.');
    console.log('   You can still approve (marks status=sent) but nothing will transmit.');
    console.log('   Add credentials to .env to enable sending.\n');
  }

  // Sort by urgency: pitches with nearest CFP deadlines first
  pending.sort((a, b) => {
    if (a.cfpDeadline && b.cfpDeadline) return a.cfpDeadline.localeCompare(b.cfpDeadline);
    if (a.cfpDeadline) return -1;
    if (b.cfpDeadline) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  await reviewDrafts(pending);
}

main().catch(err => {
  console.error('Review failed:', err.message);
  rl.close();
  process.exit(1);
});
