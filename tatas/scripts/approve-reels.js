'use strict';

// approve-reels.js — applies the hook/tone decisions from the review page.
// This is the reels-lane approval gate (mirrors Phase 1's approve-week.js).
//
// Decisions string (produced by the review page's "Copy decisions" button):
//   id:hook#   → approve that reel, saving the chosen hook (1-based index)
//   id:reject  → reject that reel
//   entries separated by ';'   e.g.  2026-07-13-MON-x:2;2026-07-13-TUE-y:reject
//
// Approve → status 'approved' + chosenHook. Reject → status 'rejected'.
// Only touches reels[] — carousel posts are never affected.
//
// usage:
//   node scripts/approve-reels.js --decisions "id:2;id2:reject"
//   node scripts/approve-reels.js --list
//   node scripts/approve-reels.js --decisions "..." --dry-run

const reelsState = require('../lib/reels-state');

const LIST    = process.argv.includes('--list');
const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function main() {
  const current = reelsState.load();

  if (LIST) {
    if (!current.reels.length) { console.log('reels[] is empty.'); return; }
    for (const r of current.reels) {
      const hook = r.chosenHook ? ` · hook: "${r.chosenHook.slice(0, 50)}"` : '';
      console.log(`${r.status.padEnd(9)} ${r.weekOf}  ${r.slot}  ${r.id}${hook}${r.audioPath ? ` · ${r.audioPath}` : ''}`);
    }
    return;
  }

  const raw = argValue('--decisions');
  if (!raw) {
    console.error('No --decisions provided. Copy the string from the review page, or use --list.');
    process.exit(1);
  }

  const byId = new Map(current.reels.map(r => [r.id, r]));
  let approved = 0, rejected = 0, skipped = 0;

  for (const entry of raw.split(';').map(s => s.trim()).filter(Boolean)) {
    const idx = entry.lastIndexOf(':');
    if (idx === -1) { console.warn(`  ⚠ malformed entry "${entry}" — skipping`); skipped++; continue; }
    const id  = entry.slice(0, idx);
    const val = entry.slice(idx + 1).toLowerCase();
    const reel = byId.get(id);
    if (!reel) { console.warn(`  ⚠ no reel with id "${id}" — skipping`); skipped++; continue; }

    if (reel.status !== 'pending') {
      console.log(`  – ${id}: already ${reel.status} — leaving as-is`);
      skipped++;
      continue;
    }

    if (val === 'reject') {
      if (!DRY_RUN) reelsState.updateReel(id, { status: 'rejected', rejectedAt: new Date().toISOString() });
      console.log(`  ✗ rejected: ${id}`);
      rejected++;
      continue;
    }

    const hookNum = parseInt(val, 10);
    if (!Number.isInteger(hookNum) || hookNum < 1 || hookNum > reel.hooks.length) {
      console.warn(`  ⚠ ${id}: invalid hook "${val}" (want 1-${reel.hooks.length}) — skipping`);
      skipped++;
      continue;
    }
    const chosenHook = reel.hooks[hookNum - 1];
    if (!DRY_RUN) reelsState.updateReel(id, { status: 'approved', chosenHook, approvedAt: new Date().toISOString() });
    console.log(`  ✓ approved: ${id} · hook ${hookNum}: "${chosenHook.slice(0, 60)}"`);
    approved++;
  }

  console.log(`\nDone.${DRY_RUN ? ' (dry run)' : ''} ${approved} approved, ${rejected} rejected, ${skipped} skipped.`);
}

main();
