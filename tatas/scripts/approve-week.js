'use strict';

// approve-week.js — the APPROVAL step. Adapted from Miley's proven module;
// operates on tatas/state.json.
//
// Flips the week's posts pending → approved; scripts/post-due.js (cron) then
// posts each at its slot time. Nothing posts without this step — review-first
// is preserved (FORCE_QUEUE convention: writer always creates 'pending').
//
// Run locally or via the tatas-approve-week GitHub Action (tap "Run workflow"
// after reviewing {BASE}/review/tatas/).
//
// usage:
//   node scripts/approve-week.js                     # approve latest week's pending posts
//   node scripts/approve-week.js --week 2026-07-13
//   node scripts/approve-week.js --skip self-check   # skip posts whose id matches (repeatable)
//   node scripts/approve-week.js --list              # show all post statuses, change nothing
//   node scripts/approve-week.js --dry-run

const state = require('../lib/state');

const LIST    = process.argv.includes('--list');
const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function argValues(flag) {
  const vals = [];
  process.argv.forEach((a, i) => { if (a === flag && process.argv[i + 1]) vals.push(process.argv[i + 1]); });
  return vals;
}

function main() {
  const current = state.load();
  if (!current.posts.length) {
    console.log('state.json has no posts — nothing to approve.');
    return;
  }

  if (LIST) {
    for (const p of current.posts) {
      console.log(`${p.status.padEnd(9)} ${p.weekOf}  ${p.slot} ${p.time}  ${p.id}${p.igMediaId ? `  ig:${p.igMediaId}` : ''}${p.lastError ? `  err:${p.lastError}` : ''}`);
    }
    return;
  }

  const weekOf = argValue('--week') || state.latestWeek(current);
  const skips  = argValues('--skip');

  const pending = current.posts.filter(p => p.weekOf === weekOf && p.status === 'pending');
  if (!pending.length) {
    console.log(`No pending posts for week ${weekOf}.`);
    return;
  }

  console.log(`Approving week of ${weekOf} — ${pending.length} pending post(s).${DRY_RUN ? ' (dry run)' : ''}`);
  let approved = 0, skipped = 0, unhosted = 0;

  for (const post of pending) {
    const skip = skips.some(s => post.id.includes(s));

    if (!skip && (!post.publicImages || !post.publicImages.length)) {
      console.warn(`  ⚠ ${post.id}: no publicImages — run publish-cards.js first or post-due will fail.`);
      unhosted++;
    }

    if (DRY_RUN) {
      console.log(`  would ${skip ? 'SKIP' : 'approve'}: ${post.id} (${post.slot} ${post.time})`);
      continue;
    }

    state.updatePost(post.id, skip
      ? { status: 'skipped',  skippedAt: new Date().toISOString() }
      : { status: 'approved', approvedAt: new Date().toISOString() });
    console.log(`  ${skip ? '⏭ skipped' : '✓ approved'}: ${post.id} → posts ${post.scheduledFor}`);
    skip ? skipped++ : approved++;
  }

  if (!DRY_RUN) console.log(`Done. ${approved} approved, ${skipped} skipped.${unhosted ? ` ${unhosted} post(s) missing hosted cards!` : ''}`);
}

main();
