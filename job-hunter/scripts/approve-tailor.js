#!/usr/bin/env node
// approve-tailor.js — the human approval gate for career-coach.js's drafts.
//
// Mirrors Trevo's scripts/approve-batch.js UX in this same repo (sibling
// system), adapted to a single job id instead of a date:
//
//   node scripts/approve-tailor.js                 # list pending drafts
//   node scripts/approve-tailor.js --list           # same, explicit
//   node scripts/approve-tailor.js --show <job-id>  # print full draft
//   node scripts/approve-tailor.js <job-id>          # approve -> writes .docx
//   node scripts/approve-tailor.js <job-id> --reject # reject, no .docx
//
// Nothing is written to .docx until this script approves it. Approving also
// promotes the newly-approved resume to be that archetype's new baseline, so
// future diffs build on the latest real version.

import path from 'node:path';
import {
  getDraft,
  pendingDrafts,
  approveDraft,
  rejectDraft,
} from '../src/lib/career-coach-store.js';
import { writeDocx, writeMarkdown } from '../src/lib/docx.js';
import { config } from '../src/lib/config.js';

function printList() {
  const pending = pendingDrafts();
  if (!pending.length) {
    console.log('No pending career-coach drafts.');
    return;
  }
  console.log(`${pending.length} pending draft(s), best fit first:\n`);
  for (const d of pending) {
    console.log(`  ${d.id}  ${d.fitPercent}%  ${d.archetype}  ${d.title} @ ${d.company}`);
  }
  console.log('\nnode scripts/approve-tailor.js --show <job-id>   # view full draft');
  console.log('node scripts/approve-tailor.js <job-id>          # approve');
  console.log('node scripts/approve-tailor.js <job-id> --reject # reject');
}

function printShow(id) {
  const draft = getDraft(id);
  if (!draft) {
    console.error(`No draft for id ${id}.`);
    process.exit(1);
  }
  console.log(`${draft.title} @ ${draft.company} — ${draft.fitPercent}% (${draft.archetype}) — status: ${draft.status}`);
  console.log(`\nVerdict: ${draft.verdict}`);
  console.log(`\nGaps:`);
  if (!draft.gaps.length) console.log('  None identified.');
  for (const g of draft.gaps || []) console.log(`  - ${g.requirement} — ${g.note}`);
  console.log(`\nOpen items flagged:`);
  if (!draft.openItemsFlagged.length) console.log('  None flagged.');
  for (const o of draft.openItemsFlagged || []) console.log(`  - ${o.item} — ${o.note}`);
  if (draft.dir) console.log(`\nFull review: ${path.join(draft.dir, 'review.md')}`);
}

async function approve(id) {
  const draft = getDraft(id);
  if (!draft) {
    console.error(`No draft for id ${id}.`);
    process.exit(1);
  }
  const res = approveDraft(id);
  if (!res.ok) {
    console.error(res.reason);
    process.exit(1);
  }

  const dir = draft.dir || path.join(config.paths.out, 'career-coach', id);
  const resumePath = await writeDocx(draft.resumeMarkdown, path.join(dir, 'resume.docx'));
  writeMarkdown(draft.resumeMarkdown, path.join(dir, 'resume.md'));
  const coverPath = await writeDocx(draft.coverLetterMarkdown, path.join(dir, 'cover-letter.docx'));
  writeMarkdown(draft.coverLetterMarkdown, path.join(dir, 'cover-letter.md'));

  // Promote this resume to be the new baseline for its archetype, so the next
  // diff for the same archetype builds on the latest approved version.
  const baselinePath = path.join(config.paths.data, 'resume-baselines', `${draft.archetype}.md`);
  writeMarkdown(draft.resumeMarkdown, baselinePath);

  console.log(`Approved ${id} (${draft.title} @ ${draft.company}).`);
  console.log(`Wrote: ${resumePath}`);
  console.log(`Wrote: ${coverPath}`);
  console.log(`Updated baseline: ${baselinePath}`);
}

function reject(id) {
  const draft = getDraft(id);
  if (!draft) {
    console.error(`No draft for id ${id}.`);
    process.exit(1);
  }
  const res = rejectDraft(id);
  if (!res.ok) {
    console.error(res.reason);
    process.exit(1);
  }
  console.log(`Rejected ${id} (${draft.title} @ ${draft.company}). No .docx written.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const reject_ = argv.includes('--reject');
  const showIdx = argv.indexOf('--show');

  if (showIdx !== -1) {
    const id = argv[showIdx + 1];
    if (!id) {
      console.error('Usage: node scripts/approve-tailor.js --show <job-id>');
      process.exit(1);
    }
    printShow(id);
    return;
  }

  const positional = argv.find((a) => !a.startsWith('--'));

  if (!positional || argv.includes('--list')) {
    printList();
    return;
  }

  if (reject_) {
    reject(positional);
  } else {
    await approve(positional);
  }
}

main().catch((e) => {
  console.error(`approve-tailor failed: ${e.message}`);
  process.exit(1);
});
