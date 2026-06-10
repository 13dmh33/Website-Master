#!/usr/bin/env node
'use strict';

// record-response.js — log a conference's reply to a pitch
//
// When a conference organizer replies to Dave (accepted / declined / waitlisted),
// run this to record it in the system. It updates the pitch draft file AND the
// opportunity store, then prints next-step instructions.
//
// If the pitch was accepted, it prompts to run closer.js automatically.
//
// Usage:
//   node scripts/record-response.js                  (interactive — pick from sent pitches)
//   node scripts/record-response.js --id <pitchId>   (go straight to a known pitch ID)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline   = require('readline');
const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');
const oppStore   = require('../lib/opportunity-store');
const clientStore = require('../lib/client-store');

const args    = process.argv.slice(2);
const pitchIdArg = (() => { const i = args.indexOf('--id'); return i !== -1 ? args[i + 1] : null; })();

const DRAFTS_DIR = path.join(__dirname, '..', 'output', 'pitches');

// ── Helpers ───────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(prompt) { return new Promise(resolve => rl.question(prompt, resolve)); }

function loadAllDrafts() {
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

function timeAgo(isoString) {
  if (!isoString) return '—';
  const days = Math.round((Date.now() - new Date(isoString).getTime()) / 86400000);
  return days === 0 ? 'today' : `${days}d ago`;
}

// ── List sent pitches ─────────────────────────────────────────────────────────

function getSentPitches(allDrafts) {
  return allDrafts
    .filter(d => (d.type === 'pitch' || d.type === 'followup') && d.status === 'sent')
    .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''));
}

function printSentPitches(pitches) {
  if (!pitches.length) {
    console.log('\nNo sent pitches found. Run: node agents/pitcher.js → node scripts/review-drafts.js');
    return false;
  }
  console.log('\n═══ Sent Pitches — Awaiting Response ═══\n');
  pitches.forEach((p, i) => {
    const responded = p.response ? `[${p.response.toUpperCase()}]` : '[no response]';
    console.log(`  ${i + 1}. ${responded} ${p.conference?.slice(0, 50) || p.id}`);
    console.log(`     Client: ${p.clientName} | Sent: ${timeAgo(p.sentAt)} | ID: ${p.id}`);
  });
  console.log('');
  return true;
}

// ── Record the response ───────────────────────────────────────────────────────

async function recordResponse(pitch, allDrafts) {
  const hasResponse = pitch.response;
  if (hasResponse) {
    console.log(`\nThis pitch already has a recorded response: ${pitch.response.toUpperCase()}`);
    const override = await ask('Override it? (y/N): ');
    if (override.trim().toLowerCase() !== 'y') {
      console.log('No changes made.');
      rl.close();
      return;
    }
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`  Recording response for:`);
  console.log(`  Conference: ${pitch.conference}`);
  console.log(`  Client:     ${pitch.clientName}`);
  console.log(`  Sent:       ${timeAgo(pitch.sentAt)}`);
  console.log('═'.repeat(56));

  const responseInput = await ask('\n  Response type — [a] Accepted  [d] Declined  [w] Waitlisted  [n] No response / withdrew: ');
  const choice = responseInput.trim().toLowerCase();

  const responseMap = { a: 'accepted', d: 'declined', w: 'waitlisted', n: 'no_response' };
  const response    = responseMap[choice];
  if (!response) {
    console.log('Unrecognized — no changes made.');
    rl.close();
    return;
  }

  let notes = '';
  if (response === 'accepted') {
    notes = await ask('  Any notes (fee confirmed, event date, etc.)? ');
  } else if (response === 'declined') {
    notes = await ask('  Decline reason (optional): ');
  }

  // Update the pitch draft file
  pitch.response     = response;
  pitch.respondedAt  = new Date().toISOString();
  pitch.responseNotes = notes.trim() || null;
  saveDraft(pitch);

  // Update the opportunity store
  if (pitch.opportunityId) {
    try {
      oppStore.recordResponse(pitch.opportunityId, pitch.clientId, response);
    } catch (err) {
      console.warn(`  Could not update opportunity store: ${err.message}`);
    }
  }

  // Update any follow-up drafts for this pitch to reflect the response
  const followups = allDrafts.filter(d => d.type === 'followup' && d.originalPitchId === pitch.id && d.status === 'draft');
  for (const fu of followups) {
    fu.status = 'cancelled';
    fu.cancelledReason = `Pitch ${response} — follow-up no longer needed`;
    saveDraft(fu);
    console.log(`  ↳ Cancelled pending follow-up draft: ${fu.id}`);
  }

  console.log(`\n  ✓ Response recorded: ${response.toUpperCase()}`);

  // Next steps based on response
  if (response === 'accepted') {
    const client = clientStore.getClient(pitch.clientId);
    console.log('\n' + '─'.repeat(56));
    console.log('  🎉 Accepted! Next steps:');
    console.log(`  1. Run closer.js to draft the confirmation emails:`);
    console.log(`     node agents/closer.js --pitch ${pitch.id}`);
    console.log(`  2. Review and send: node scripts/review-drafts.js --type closer`);
    if (client) {
      console.log(`  3. Update ${client.name}'s client profile with the booking.`);
    }

    const runCloser = await ask('\n  Run closer.js now? (Y/n): ');
    if (runCloser.trim().toLowerCase() !== 'n') {
      rl.close();
      console.log('\n');
      try {
        execSync(`node "${path.join(__dirname, '..', 'agents', 'closer.js')}" --pitch ${pitch.id}`, {
          stdio:   'inherit',
          cwd:     path.join(__dirname, '..'),
          timeout: 120000,
        });
      } catch (err) {
        console.error(`Closer exited: ${err.message}`);
      }
      return;
    }
  } else if (response === 'declined') {
    console.log('\n  Pipeline updated. The scout will find new opportunities on the next run.');
  } else if (response === 'waitlisted') {
    console.log('\n  Marked waitlisted. Check back in 2 weeks — run follower.js to draft a check-in.');
  }

  rl.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const allDrafts = loadAllDrafts();
  const sentPitches = getSentPitches(allDrafts);

  let pitch;

  if (pitchIdArg) {
    pitch = allDrafts.find(d => d.id === pitchIdArg);
    if (!pitch) {
      console.error(`No pitch found with ID: ${pitchIdArg}`);
      rl.close();
      process.exit(1);
    }
  } else {
    const hasPitches = printSentPitches(sentPitches);
    if (!hasPitches) { rl.close(); return; }

    const input = await ask('  Enter number to select, or pitch ID: ');
    const num   = parseInt(input.trim(), 10);

    if (!isNaN(num) && num >= 1 && num <= sentPitches.length) {
      pitch = sentPitches[num - 1];
    } else {
      pitch = allDrafts.find(d => d.id === input.trim());
    }

    if (!pitch) {
      console.log('Not found — no changes made.');
      rl.close();
      return;
    }
  }

  await recordResponse(pitch, allDrafts);
}

main().catch(err => {
  console.error('record-response failed:', err.message);
  try { rl.close(); } catch {}
  process.exit(1);
});
