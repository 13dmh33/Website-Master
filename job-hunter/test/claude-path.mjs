// claude-path.mjs — test the paid Claude path on ONE built-in sample job.
//
// This validates scoring + tailoring (and the truthfulness rules) without
// needing Adzuna keys or any live job source — just ANTHROPIC_API_KEY and your
// parsed resume (run `npm run ingest` first). It scores a hardcoded sample
// posting against your real profile, then tailors a resume + cover letter and
// writes them to out/test-claude/. Cost is two small calls (one Haiku, one
// Sonnet) — a few cents.
//
// Run with: `npm run test:claude`

import fs from 'node:fs';
import path from 'node:path';
import { config, has } from '../src/lib/config.js';
import { readPreferences } from '../src/lib/preferences.js';
import { scoreJob, tailorJob } from '../src/lib/claude.js';
import { writeDocx, writeMarkdown } from '../src/lib/docx.js';

if (!has.claude()) {
  console.log('skip: ANTHROPIC_API_KEY not set. Add it to .env, then re-run.');
  process.exit(0);
}

let profile;
try {
  profile = JSON.parse(fs.readFileSync(config.paths.masterProfile, 'utf8'));
} catch {
  console.log('skip: data/master-profile.json not found. Run `npm run ingest` first.');
  process.exit(0);
}
const { text: preferencesText } = readPreferences();

// A realistic sample posting to score/tailor against.
const job = {
  company: 'Example Building Products',
  title: 'Director, National Accounts',
  location: 'Remote (US)',
  remote: true,
  description: [
    'We are hiring a Director of National Accounts to own strategy, P&L, and',
    'go-to-market for our largest commercial and multifamily customers.',
    'Responsibilities: negotiate master agreements (MSA/MPA/SOW), pricing, and',
    'rebate structures; build and grow a book of national accounts; own pricing',
    'governance and margin analysis; present to executive stakeholders.',
    'Requirements: 10+ years in national account leadership, quota-carrying',
    'experience, strong finance/P&L command, contract negotiation, and public',
    'speaking. Building-products or HVAC distribution background a plus.',
  ].join(' '),
};

console.log(`Scoring: ${job.title} @ ${job.company} ...`);
const score = await scoreJob({ job, profile, preferencesText, feedbackExamples: [] });
console.log(`  fit: ${score.fit}/100`);
console.log(`  why: ${score.rationale}`);
console.log(`  keywords to mirror: ${score.keywords.join(', ')}`);

console.log('\nTailoring resume + cover letter ...');
const tailored = await tailorJob({ job, profile, preferencesText });
const dir = path.join(config.paths.out, 'test-claude');
writeMarkdown(tailored.resumeMarkdown, path.join(dir, 'resume.md'));
writeMarkdown(tailored.coverLetterMarkdown, path.join(dir, 'cover-letter.md'));
await writeDocx(tailored.resumeMarkdown, path.join(dir, 'resume.docx'));
await writeDocx(tailored.coverLetterMarkdown, path.join(dir, 'cover-letter.docx'));

console.log(`  covered key terms: ${tailored.coveredKeywords.join(', ') || '(none reported)'}`);
console.log(`  omitted (not faked): ${tailored.missingKeywords.join(', ') || '(none)'}`);
console.log(`  wrote resume + cover letter to ${path.relative(config.paths.root, dir)}/`);
console.log('\nOpen those files and spot-check: every claim should trace back to your real resume.');
