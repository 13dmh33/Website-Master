#!/usr/bin/env node
'use strict';

// review-leads.js — review routed DM conversations and onboard clients
//
// Shows all DM conversations that have been fully qualified (scored + routed)
// but haven't been converted into client profiles yet.
//
// Usage:
//   node scripts/review-leads.js           (interactive — review and onboard)
//   node scripts/review-leads.js --list    (just print the queue, no prompts)
//   node scripts/review-leads.js --high    (show high-fit leads only)
//   node scripts/review-leads.js --scout   (show scout-fit leads only)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline    = require('readline');
const path        = require('path');
const { execSync } = require('child_process');
const state       = require('../lib/state');
const clientStore = require('../lib/client-store');

const args       = process.argv.slice(2);
const isList     = args.includes('--list');
const highOnly   = args.includes('--high');
const scoutOnly  = args.includes('--scout');

const SCORE_ORDER  = { high: 0, mid: 1, scout: 2, low: 3 };
const SCORE_LABEL  = { high: '🟢 HIGH', mid: '🟡 MID ', scout: '🔵 SCOUT', low: '⚫ LOW  ' };

// ── Helpers ───────────────────────────────────────────────────────────────────

// Check whether a DM sender has already been converted to a client profile
function isOnboarded(senderId) {
  return clientStore.getAllClients().some(c => c.dmSenderId === senderId);
}

function timeAgo(isoString) {
  if (!isoString) return 'unknown';
  const mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ── Load pending leads ────────────────────────────────────────────────────────

function getPendingLeads() {
  const conversations = state.getAllActive();

  return conversations
    .filter(c => c.routed && c.score)
    .filter(c => !isOnboarded(c.senderId))
    .filter(c => !highOnly  || c.score === 'high')
    .filter(c => !scoutOnly || c.score === 'scout')
    .sort((a, b) => {
      // Sort by score priority (high first), then by time (newest first)
      const scoreDiff = (SCORE_ORDER[a.score] ?? 9) - (SCORE_ORDER[b.score] ?? 9);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.routedAt || '').localeCompare(a.routedAt || '');
    });
}

// ── Display ───────────────────────────────────────────────────────────────────

function printLead(convo, index, total) {
  const label = SCORE_LABEL[convo.score] || convo.score.toUpperCase();
  const name  = convo.senderName || `(no name — ID: ${convo.senderId})`;

  console.log('\n' + '═'.repeat(56));
  console.log(`  ${label}  ${index}/${total} — routed ${timeAgo(convo.routedAt)}`);
  console.log('═'.repeat(56));
  console.log(`  Name:       ${name}`);
  console.log(`  Sender ID:  ${convo.senderId}`);
  console.log('─'.repeat(56));
  console.log(`  Paid gigs (12mo): ${convo.answers?.paid_talks_count || '—'}`);
  console.log(`  Keynote fee:      ${convo.answers?.fee_range        || '—'}`);
  console.log(`  Topic/niche:      ${convo.answers?.topic            || '—'}`);
  console.log('─'.repeat(56));

  if (convo.score === 'high') {
    console.log('  ✓ They were sent the Cal.com booking link automatically.');
  } else if (convo.score === 'mid') {
    console.log('  → Dave should follow up within 24 hours.');
  } else if (convo.score === 'scout') {
    console.log('  → Offered Scout tier ($97/mo). Follow up if they reply "yes".');
  } else {
    console.log('  → Declined. No immediate action needed.');
  }
}

function printList(leads) {
  if (!leads.length) {
    const filter = highOnly ? ' high-fit' : scoutOnly ? ' scout-fit' : '';
    console.log(`\nNo pending${filter} leads awaiting onboarding.`);
    return;
  }

  const byScore = { high: [], mid: [], scout: [], low: [] };
  for (const l of leads) {
    (byScore[l.score] || byScore.low).push(l);
  }

  console.log('\n═══ Reeve Pending Leads ═══\n');

  for (const [score, group] of Object.entries(byScore)) {
    if (!group.length) continue;
    const label = { high: '🟢 HIGH FIT', mid: '🟡 MID FIT', scout: '🔵 SCOUT FIT', low: '⚫ DECLINED' }[score];
    console.log(`${label} (${group.length})`);
    for (const c of group) {
      const name    = c.senderName || c.senderId;
      const fee     = c.answers?.fee_range || '—';
      const topic   = c.answers?.topic || '—';
      const routed  = timeAgo(c.routedAt);
      console.log(`  • ${name} | fee: ${fee} | topic: ${topic} | ${routed}`);
      console.log(`    onboard: node scripts/onboard-client.js --from-dm ${c.senderId}`);
    }
    console.log('');
  }

  const alreadyOnboarded = state.getAllActive()
    .filter(c => c.routed && isOnboarded(c.senderId)).length;

  console.log(`Already onboarded: ${alreadyOnboarded}`);
  console.log('═'.repeat(25));
}

// ── Interactive review ────────────────────────────────────────────────────────

function newReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

let rl = newReadline();
function ask(prompt) { return new Promise(resolve => rl.question(prompt, resolve)); }

async function reviewLeads(leads) {
  let onboarded = 0, skipped = 0;

  for (let i = 0; i < leads.length; i++) {
    const convo = leads[i];
    printLead(convo, i + 1, leads.length);

    const answer = await ask('\n  [o] Onboard as client  [s] Skip  [q] Quit: ');
    const choice = answer.trim().toLowerCase();

    if (choice === 'q') {
      console.log('\nQuitting — remaining leads untouched.');
      break;
    }

    if (choice === 's') {
      skipped++;
      continue;
    }

    if (choice === 'o') {
      console.log(`\n  Launching onboarding wizard for ${convo.senderName || convo.senderId}...\n`);
      rl.close();

      // Hand off to the onboard wizard — it runs interactively in the same terminal
      try {
        const scriptPath = path.join(__dirname, 'onboard-client.js');
        execSync(
          `node "${scriptPath}" --from-dm ${convo.senderId}`,
          { stdio: 'inherit', cwd: path.join(__dirname, '..') }
        );
        onboarded++;
      } catch (err) {
        console.error(`  Onboarding exited: ${err.message}`);
      }

      // Re-open readline so the loop can keep prompting for remaining leads
      rl = newReadline();
      continue;
    }

    // Unrecognized input — re-prompt next iteration counts as skip
    console.log('  Unrecognized — skipping.');
    skipped++;
  }

  try { rl.close(); } catch {}

  console.log('\n' + '─'.repeat(50));
  console.log(`Done. Onboarded: ${onboarded} | Skipped: ${skipped}`);
  if (onboarded > 0) {
    console.log('\nNext: run "node agents/pitcher.js" to generate pitches for new clients.');
  }
  console.log('─'.repeat(50));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const leads = getPendingLeads();

  if (isList) {
    printList(leads);
    return;
  }

  if (!leads.length) {
    const filter = highOnly ? ' high-fit' : scoutOnly ? ' scout-fit' : '';
    console.log(`\nNo pending${filter} leads awaiting onboarding.`);
    console.log('Leads appear here after speakers DM "stages" and complete the 3-question flow.');
    return;
  }

  const filter = highOnly ? ' (high-fit only)' : scoutOnly ? ' (scout-fit only)' : '';
  console.log(`\n${leads.length} lead(s) pending onboarding${filter}.`);
  await reviewLeads(leads);
}

main().catch(err => {
  console.error('review-leads failed:', err.message);
  try { rl.close(); } catch {}
  process.exit(1);
});
