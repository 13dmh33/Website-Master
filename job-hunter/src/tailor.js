// tailor.js — Stage 4. Tailor a resume + cover letter for each kept job.
//
// Only above-threshold jobs, capped at DAILY_LIMIT, reach this stage (the most
// expensive one — Claude Sonnet). For each, the tailor reorders and rephrases
// REAL content from the master profile to mirror the posting; it never invents
// experience. Each job's deliverables are written to:
//   out/<date>/<company>-<title>/resume.docx + resume.md
//                                cover-letter.docx + cover-letter.md
// Dave gets the .md source (easy to edit) and the .docx (ready to attach).

import path from 'node:path';
import { config } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { tailorJob } from './lib/claude.js';
import { writeDocx, writeMarkdown } from './lib/docx.js';

const log = makeLogger('tailor');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
}

function dateDir(now) {
  return now.toISOString().slice(0, 10);
}

export async function runTailor(matches, { profile, preferencesText, limit, dryRun = false, now = new Date() } = {}) {
  // Short-circuit before any work, rather than by way of a zero-length slice.
  // The matches themselves pass straight through untouched, so every later
  // stage — the career coach, the digest, the Sheet write — sees exactly what
  // it saw before, minus the two generated documents.
  if (!config.tailorEnabled) {
    log.info(`tailoring disabled (TAILOR_ENABLED=false) — ${matches.length} match(es) pass through unmodified.`);
    return matches.map((job) => ({ ...job }));
  }

  const cap = limit ?? config.dailyLimit;
  const selected = matches.slice(0, cap);
  const out = [];

  for (const job of selected) {
    try {
      const tailored = await tailorJob({ job, profile, preferencesText });
      const dir = path.join(config.paths.out, dateDir(now), `${slug(job.company)}-${slug(job.title)}`);

      const deliverables = {
        dir,
        coveredKeywords: tailored.coveredKeywords,
        missingKeywords: tailored.missingKeywords,
      };

      if (!dryRun) {
        deliverables.resumeMd = writeMarkdown(tailored.resumeMarkdown, path.join(dir, 'resume.md'));
        deliverables.coverMd = writeMarkdown(tailored.coverLetterMarkdown, path.join(dir, 'cover-letter.md'));
        deliverables.resumeDocx = await writeDocx(tailored.resumeMarkdown, path.join(dir, 'resume.docx'));
        deliverables.coverDocx = await writeDocx(tailored.coverLetterMarkdown, path.join(dir, 'cover-letter.docx'));
        log.info(`tailored ${job.company} — ${job.title} -> ${path.relative(config.paths.root, dir)}`);
      } else {
        log.info(`[dry-run] would tailor ${job.company} — ${job.title} (no files written).`);
      }

      out.push({ ...job, deliverables });
    } catch (e) {
      log.warn(`tailoring failed for "${job.title}" @ ${job.company}: ${e.message}`);
      out.push({ ...job, deliverables: null, tailorError: e.message });
    }
  }

  return out;
}
