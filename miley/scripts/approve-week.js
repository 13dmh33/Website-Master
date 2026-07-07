'use strict';

// approve-week.js — the APPROVAL step for direct Instagram posting.
//
// Replaces "run push-queue.js on the Mac" as the approval act. Flips the week's
// queue records from pending → approved; scripts/post-due.js (cron) then posts
// each one at its slot time. Nothing posts without this step — FORCE_QUEUE
// review-first is preserved.
//
// Run from anywhere (Mac, container, or the miley-approve-week GitHub Action —
// tap "Run workflow" in the GitHub app after reviewing /review/miley/).
//
// usage:
//   node scripts/approve-week.js                      # approve latest week's pending posts
//   node scripts/approve-week.js --week 2026-07-13
//   node scripts/approve-week.js --skip tue-community # skip a slot (repeatable, matches slot name)
//   node scripts/approve-week.js --list               # show queue status, change nothing
//   node scripts/approve-week.js --dry-run

const fs   = require('fs');
const path = require('path');
const store = require('../lib/store');

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

function loadQueueRecords() {
  const queueDir = store.paths.queue;
  if (!fs.existsSync(queueDir)) return [];
  return fs.readdirSync(queueDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('preview-'))
    .sort()
    .map(f => {
      const filePath = path.join(queueDir, f);
      return { file: f, filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    });
}

function main() {
  const records = loadQueueRecords();
  if (!records.length) {
    console.log('Queue is empty — nothing to approve.');
    return;
  }

  if (LIST) {
    for (const r of records) {
      console.log(`${r.data.status.padEnd(9)} ${r.data.weekOf}  ${r.data.day} ${r.data.time}  ${r.data.slot || r.file}${r.data.igMediaId ? `  ig:${r.data.igMediaId}` : ''}`);
    }
    return;
  }

  const weeks  = [...new Set(records.map(r => r.data.weekOf))].sort();
  const weekOf = argValue('--week') || weeks[weeks.length - 1];
  const skips  = argValues('--skip');

  const pending = records.filter(r => r.data.weekOf === weekOf && r.data.status === 'pending');
  if (!pending.length) {
    console.log(`No pending posts for week ${weekOf}. (Weeks in queue: ${weeks.join(', ')})`);
    return;
  }

  console.log(`Approving week of ${weekOf} — ${pending.length} pending post(s).${DRY_RUN ? ' (dry run)' : ''}`);
  let approved = 0, skipped = 0, unhosted = 0;

  for (const rec of pending) {
    const slotName = rec.data.slot || rec.file;
    const skip = skips.some(s => slotName.includes(s));

    if (!skip && (!rec.data.publicImages || !rec.data.publicImages.length)) {
      console.warn(`  ⚠ ${slotName}: no publicImages — run publish-cards.js first or post-due will fail.`);
      unhosted++;
    }

    if (DRY_RUN) {
      console.log(`  would ${skip ? 'SKIP' : 'approve'}: ${slotName} (${rec.data.day} ${rec.data.time})`);
      continue;
    }

    rec.data.status = skip ? 'skipped' : 'approved';
    rec.data[skip ? 'skippedAt' : 'approvedAt'] = new Date().toISOString();
    fs.writeFileSync(rec.filePath, JSON.stringify(rec.data, null, 2), 'utf8');
    console.log(`  ${skip ? '⏭ skipped' : '✓ approved'}: ${slotName} → posts ${rec.data.scheduledFor}`);
    skip ? skipped++ : approved++;
  }

  if (!DRY_RUN) console.log(`Done. ${approved} approved, ${skipped} skipped.${unhosted ? ` ${unhosted} post(s) missing hosted cards!` : ''}`);
}

main();
