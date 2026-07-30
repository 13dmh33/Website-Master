#!/usr/bin/env node
// interview-prep.js — the interview-prep thread named in career-context.md's
// own title ("resume, job search, and interview prep") but not built until
// now. On-demand, not part of the daily cron — you run this when an
// interview actually gets scheduled, against a job already tracked by
// career-coach.js.
//
// Usage:
//   node scripts/interview-prep.js <job-id>
//
// Looks up the job + the resume actually used (career-coach-store.js), loads
// the same career-context.md brief, and writes interview-prep.md next to the
// existing review.md / resume.docx for that job. Nothing is emailed — this is
// a local reference document, reviewed on your own schedule before a specific
// interview, not a daily digest item.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/lib/config.js';
import { prepareInterview } from '../src/lib/claude.js';
import { getDraft } from '../src/lib/career-coach-store.js';
import { writeMarkdown } from '../src/lib/docx.js';

function loadBrief() {
  const briefPath = path.join(config.paths.data, 'career-context.md');
  try {
    return fs.readFileSync(briefPath, 'utf8');
  } catch {
    return null;
  }
}

function renderPrepDoc({ job, result }) {
  const lines = [
    `# Interview prep — ${job.title} at ${job.company}`,
    '',
    '## Likely questions',
    '',
  ];
  for (const q of result.likelyQuestions) {
    lines.push(`- **[${q.category}]** ${q.question}`);
  }
  lines.push('', '## STAR-format stories (grounded in vetted brief accomplishments)', '');
  for (const s of result.starStories) {
    lines.push(`### ${s.accomplishment}`);
    lines.push(`- **Situation:** ${s.situation}`);
    lines.push(`- **Task:** ${s.task}`);
    lines.push(`- **Action:** ${s.action}`);
    lines.push(`- **Result:** ${s.result}`);
    lines.push('');
  }
  lines.push('## Gap talking points — honest, not fabricated', '');
  if (result.gapTalkingPoints.length === 0) {
    lines.push('None identified.');
  } else {
    for (const g of result.gapTalkingPoints) {
      lines.push(`- **${g.gap}** — ${g.honestResponse}`);
    }
  }
  lines.push('', '## Open items this prep touches (resolve before the interview)', '');
  if (result.openItemsFlagged.length === 0) {
    lines.push('None flagged.');
  } else {
    for (const o of result.openItemsFlagged) {
      lines.push(`- **${o.item}** — ${o.note}`);
    }
  }
  lines.push('', '## Questions to ask them', '');
  for (const q of result.questionsToAsk) {
    lines.push(`- ${q}`);
  }
  return lines.join('\n');
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node scripts/interview-prep.js <job-id>');
    process.exit(1);
  }

  const draft = getDraft(jobId);
  if (!draft) {
    console.error(`No career-coach draft found for id ${jobId}. Interview prep works off a job career-coach.js already tailored a resume for.`);
    process.exit(1);
  }

  const brief = loadBrief();
  if (!brief) {
    console.error('data/career-context.md not found — cannot generate interview prep without it.');
    process.exit(1);
  }

  console.log(`Preparing interview material for ${draft.title} @ ${draft.company} (draft status: ${draft.status})...`);
  const result = await prepareInterview({
    job: { company: draft.company, title: draft.title, location: draft.location, description: draft.description },
    brief,
    resumeMarkdown: draft.resumeMarkdown,
    archetype: draft.archetype,
  });

  const dir = draft.dir || path.join(config.paths.out, 'career-coach', jobId);
  const prepDoc = renderPrepDoc({ job: draft, result });
  const prepPath = writeMarkdown(prepDoc, path.join(dir, 'interview-prep.md'));

  console.log(`Interview prep written to: ${prepPath}`);
  console.log(`${result.likelyQuestions.length} likely questions, ${result.starStories.length} STAR stories, ${result.gapTalkingPoints.length} gap talking points.`);
  if (result.openItemsFlagged.length > 0) {
    console.warn(`\nOPEN ITEMS FLAGGED — resolve before the interview:`);
    for (const o of result.openItemsFlagged) console.warn(`  - ${o.item}: ${o.note}`);
  }
}

main().catch((e) => {
  console.error(`interview-prep failed: ${e.message}`);
  process.exit(1);
});
