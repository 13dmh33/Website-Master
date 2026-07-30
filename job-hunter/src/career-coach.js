// career-coach.js — Dave's personal career-coach review, running alongside
// (not replacing) tailor.js's automatic resume/cover-letter generation.
//
// Difference from tailor.js:
//   - Re-ranks today's matches against Dave's own career-context brief
//     (data/career-context.md), which is allowed to disagree with scorer.js's
//     fit score — that's the point, not a bug.
//   - Only the top 1-3 by that re-ranked priority get a draft at all.
//   - Produces a highlighted diff against the last approved resume for the
//     same archetype, plus a gap analysis and an open-items cross-check.
//   - Writes NOTHING to .docx. A draft sits pending until Dave explicitly
//     approves it via scripts/approve-tailor.js.
//
// Output per top job: { job, careerCoach } where careerCoach carries
// fitPercent, verdict, archetype, diffMarkdown, gaps, openItemsFlagged, and
// the exact approve/reject command.

import fs from 'node:fs';
import path from 'node:path';
import { diffWords } from 'diff';
import { config } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { rerankForCareerCoach, careerCoachTailor } from './lib/claude.js';
import { writeMarkdown } from './lib/docx.js';
import { createDraft } from './lib/career-coach-store.js';

const log = makeLogger('career-coach');

const ARCHETYPES = ['sales-planning', 'finance', 'national-accounts'];

function slug(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'job'
  );
}

function dateDir(now) {
  return now.toISOString().slice(0, 10);
}

function loadBrief() {
  const briefPath = path.join(config.paths.data, 'career-context.md');
  try {
    return fs.readFileSync(briefPath, 'utf8');
  } catch {
    return null;
  }
}

function baselinePath(archetype) {
  return path.join(config.paths.data, 'resume-baselines', `${archetype}.md`);
}

function loadBaseline(archetype) {
  try {
    return fs.readFileSync(baselinePath(archetype), 'utf8');
  } catch {
    return null;
  }
}

// Deterministic word-level diff, rendered as Markdown. Not asking the model to
// self-report changes — a real diff library is more trustworthy and
// reproducible, matching the brief's "every number must be vetted" discipline.
function diffToMarkdown(baseline, updated) {
  if (!baseline) {
    return { hasBaseline: false, markdown: updated };
  }
  const parts = diffWords(baseline, updated);
  const rendered = parts
    .map((p) => {
      if (p.added) return `**${p.value}**`;
      if (p.removed) return `~~${p.value}~~`;
      return p.value;
    })
    .join('');
  return { hasBaseline: true, markdown: rendered };
}

function renderReview({ job, result, diff }) {
  const lines = [
    `# Career-coach review — ${job.title} at ${job.company}`,
    '',
    `Fit: ${result.fitPercent}% — ${result.verdict}`,
    `Archetype: ${result.archetype}`,
    '',
    '## Highlighted resume changes',
    diff.hasBaseline
      ? '(added text in **bold**, removed text in ~~strikethrough~~, vs. the last approved resume for this archetype)'
      : '(no prior approved resume for this archetype yet — showing the full draft as new)',
    '',
    diff.markdown,
    '',
    '## Gaps — role asks for this, current brief shows no evidence of it',
  ];
  if (result.gaps.length === 0) {
    lines.push('None identified.');
  } else {
    for (const g of result.gaps) lines.push(`- **${g.requirement}** — ${g.note}`);
  }
  lines.push('', '## Open items this draft touches (resolve before approving)');
  if (result.openItemsFlagged.length === 0) {
    lines.push('None flagged.');
  } else {
    for (const o of result.openItemsFlagged) lines.push(`- **${o.item}** — ${o.note}`);
  }
  lines.push(
    '',
    '## Cover letter draft',
    '',
    result.coverLetterMarkdown,
    '',
    '## To approve or reject',
    '',
    `node scripts/approve-tailor.js ${job.id}`,
    `node scripts/approve-tailor.js ${job.id} --reject`,
  );
  return lines.join('\n');
}

export async function runCareerCoach(matches, { now = new Date(), topN = 3, dryRun = false } = {}) {
  if (!matches.length) return [];

  const brief = loadBrief();
  if (!brief) {
    log.warn('data/career-context.md not found — skipping career-coach review.');
    return [];
  }

  log.info(`re-ranking ${matches.length} match(es) against the career-context brief...`);
  let ranked;
  try {
    ({ ranked } = await rerankForCareerCoach({ jobs: matches, brief }));
  } catch (e) {
    // A career-coach failure must never take down the whole daily run — the
    // digest/sheet-log/state stages downstream still need to complete even if
    // this new, non-critical step can't run (e.g. an API outage or, as found
    // during testing, an exhausted Anthropic credit balance).
    log.warn(`re-rank failed, skipping career-coach review this run: ${e.message}`);
    return [];
  }
  const byId = new Map(matches.map((j) => [j.id, j]));
  const top = ranked
    .filter((r) => byId.has(r.id))
    .slice(0, topN);

  if (!top.length) {
    log.info('re-rank produced no candidates.');
    return [];
  }

  const baselines = Object.fromEntries(ARCHETYPES.map((a) => [a, loadBaseline(a)]));

  const out = [];
  for (const r of top) {
    const job = byId.get(r.id);
    try {
      const result = await careerCoachTailor({ job, brief, baselines });
      const archetype = ARCHETYPES.includes(result.archetype) ? result.archetype : 'finance';
      const diff = diffToMarkdown(baselines[archetype], result.resumeMarkdown);

      const dir = path.join(config.paths.out, dateDir(now), 'career-coach', `${slug(job.company)}-${slug(job.title)}`);
      const reviewMd = renderReview({ job, result: { ...result, archetype }, diff });

      let reviewPath = null;
      if (!dryRun) {
        reviewPath = writeMarkdown(reviewMd, path.join(dir, 'review.md'));
        createDraft(job.id, {
          company: job.company,
          title: job.title,
          location: job.location,
          url: job.url,
          description: job.description,
          fitPercent: result.fitPercent,
          verdict: result.verdict,
          archetype,
          resumeMarkdown: result.resumeMarkdown,
          coverLetterMarkdown: result.coverLetterMarkdown,
          gaps: result.gaps,
          openItemsFlagged: result.openItemsFlagged,
          dir,
        });
        log.info(`draft ready for ${job.company} — ${job.title} (${result.fitPercent}% fit, ${archetype}).`);
      } else {
        log.info(`[dry-run] would draft ${job.company} — ${job.title} (${result.fitPercent}% fit, ${archetype}).`);
      }

      out.push({
        job,
        careerCoach: {
          fitPercent: result.fitPercent,
          verdict: result.verdict,
          archetype,
          diffMarkdown: diff.markdown,
          hasBaseline: diff.hasBaseline,
          gaps: result.gaps,
          openItemsFlagged: result.openItemsFlagged,
          reviewPath,
          approveCommand: `node scripts/approve-tailor.js ${job.id}`,
          rejectCommand: `node scripts/approve-tailor.js ${job.id} --reject`,
        },
      });
    } catch (e) {
      log.warn(`career-coach draft failed for "${job.title}" @ ${job.company}: ${e.message}`);
    }
  }

  return out;
}
