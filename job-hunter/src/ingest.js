// ingest.js — Step 0. Runs before anything else and stops for Dave to confirm.
//
// What it does:
//   1. Parse inputs/master-resume.docx (mammoth) or .pdf (pdf-parse) into
//      data/master-profile.json. The profile keeps the full raw resume text as
//      the source of truth (tailoring may only use real content from here),
//      plus a light structured layer (name, contact, links, sections).
//   2. Scaffold inputs/preferences.md if it is missing, seeded with sensible
//      defaults inferred from the resume for Dave to edit.
//   3. Establish state.json (append-only ledger) and the Google Sheet schema.
//   4. Print the parsed profile so Dave can confirm before tailoring is built.
//
// This never calls a paid API — it is pure parsing and scaffolding.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, has } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { loadState, saveState } from './lib/state.js';

const log = makeLogger('ingest');

function findResume() {
  let entries = [];
  try {
    entries = fs.readdirSync(config.paths.inputs);
  } catch {
    return null;
  }
  const match = entries.find((f) => /^master-resume\.(docx|pdf)$/i.test(f));
  return match ? path.join(config.paths.inputs, match) : null;
}

async function extractText(file) {
  if (/\.docx$/i.test(file)) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ path: file });
    return value;
  }
  // Import the inner lib to avoid pdf-parse's debug harness on the package root.
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdfParse(fs.readFileSync(file));
  return data.text;
}

const SECTION_HEADINGS = [
  'summary',
  'objective',
  'experience',
  'work experience',
  'professional experience',
  'employment',
  'education',
  'skills',
  'certifications',
  'projects',
  'awards',
  'volunteer',
];

// Inline "Label: value" lines that carry skills but are not section headings.
// Resumes often list competencies this way instead of under a SKILLS heading —
// the canonical resume has "Core strengths:" in the header block and "Tools:"
// under education. Before this, both fell into whichever section happened to be
// open and no skills section existed at all.
const INLINE_SKILL_LABELS = ['core strengths', 'core competencies', 'tools', 'skills', 'technical skills'];

// Normalize a line for heading comparison: lowercase, drop anything that is not
// a letter or space, then collapse the whitespace runs that leaves behind.
//
// The collapse matters. "EDUCATION & PROFESSIONAL DEVELOPMENT" loses its "&"
// and becomes "education  professional development" with a double space, which
// failed exact matching against "education" and would defeat a naive prefix
// test too if the spacing were not repaired first.
function normalizeHeading(line) {
  return line.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Does this line open a section? Matches by PREFIX rather than exact string, so
// "EDUCATION & PROFESSIONAL DEVELOPMENT" opens education.
//
// Guarded against false positives: a body line such as "Skills in negotiation
// were developed…" also begins with a heading word, and a bare prefix test
// would silently split the resume mid-sentence. Real headings are short and
// unbulleted, which separates them well enough here.
function matchSectionHeading(line) {
  const raw = (line || '').trim();
  if (!raw || raw.length > 60) return null;
  if (/^[•\-*]/.test(raw)) return null;
  const bare = normalizeHeading(raw);
  if (!bare) return null;
  // Longest heading first so "professional experience" wins over "experience".
  for (const heading of [...SECTION_HEADINGS].sort((a, b) => b.length - a.length)) {
    if (bare === heading || bare.startsWith(`${heading} `)) return heading;
  }
  return null;
}

// An inline skills label like "Tools: Salesforce • HubSpot". Returns the value.
function matchInlineSkillLabel(line) {
  const m = (line || '').match(/^\s*([A-Za-z][A-Za-z /&-]{2,30}?)\s*:\s*(.*)$/);
  if (!m) return null;
  if (!INLINE_SKILL_LABELS.includes(normalizeHeading(m[1]))) return null;
  return { label: m[1].trim(), value: m[2].trim() };
}

// Light structuring. We keep raw_text as the truthful source; this layer is
// just to make the printed confirmation readable and to give the scorer hints.
function structure(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);

  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '';
  const phone = (text.match(/(\+?\d[\d\s().-]{8,}\d)/) || [])[0] || '';
  const links = [...text.matchAll(/https?:\/\/[^\s)]+|(?:linkedin\.com|github\.com)\/[^\s)]+/gi)].map(
    (m) => m[0],
  );
  const name = nonEmpty[0] && nonEmpty[0].length <= 60 ? nonEmpty[0] : '';

  // Best-effort location: first "City, ST" found on a single line near the top.
  let location = '';
  for (const line of nonEmpty.slice(0, 12)) {
    const m = line.match(/([A-Z][a-zA-Z.]+(?:[ ][A-Z][a-zA-Z.]+)*,\s*[A-Z]{2})\b/);
    if (m) {
      location = m[1].trim();
      break;
    }
  }

  // Headline: the first ALL-CAPS line after the name that reads like a title
  // (e.g. "COMMERCIAL NATIONAL ACCOUNTS LEADER"). Used to seed search queries.
  const headline =
    nonEmpty
      .slice(1, 8)
      .find((l) => /^[A-Z0-9 &/,'.-]{8,60}$/.test(l) && /[A-Z]{3,}/.test(l) && l !== (name || '').toUpperCase()) || '';

  // Split into rough sections by heading lines.
  const sections = {};
  let current = 'header';
  sections[current] = [];
  // Inline skill labels wrap across several physical lines in extracted PDF
  // text, so once one opens we keep absorbing until a blank line, the next
  // section heading, or another label — otherwise only the first line of
  // "Core strengths: …" would be captured.
  let absorbingSkills = false;
  for (const line of lines) {
    const heading = matchSectionHeading(line);
    if (heading) {
      current = heading;
      sections[current] = sections[current] || [];
      absorbingSkills = false;
      continue;
    }

    const inline = matchInlineSkillLabel(line);
    if (inline) {
      sections.skills = sections.skills || [];
      if (inline.value) sections.skills.push(inline.value);
      absorbingSkills = true;
      continue;
    }

    if (absorbingSkills) {
      if (!line.trim()) { absorbingSkills = false; continue; }
      sections.skills.push(line);
      continue;
    }

    (sections[current] = sections[current] || []).push(line);
  }
  const sectionText = {};
  for (const [k, v] of Object.entries(sections)) {
    sectionText[k] = v.join('\n').trim();
  }

  return { name, email, phone, links: [...new Set(links)], location, headline, sections: sectionText };
}

// Content hash of the source file. sourceFile records only a basename, so
// "which resume produced this profile" was unanswerable — master-resume.pdf can
// be replaced in place and the recorded name never changes. Every tailored
// document inherits whatever timeline the parsed file contained, which makes
// that an integrity question, not a convenience one.
function hashFile(file) {
  try {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)}`;
  } catch {
    return null;
  }
}

// Hand-maintained corrections that outrank the parsed resume.
//
// This profile is regenerated on every ingest, so anything written directly
// into it is destroyed by the next run — which makes hand-patching the wrong
// tool for a durable fact. data/vetted-claims.json is maintained by hand and
// merged here instead, so a correction survives re-parsing.
//
// It exists because the resume can be stale in ways re-parsing cannot fix: the
// current PDF says the personal book reached ~$4M, and the verified figure is
// ~$6M. Both the scorer and the tailor receive the whole profile object, so
// they see these blocks next to the resume text, and the file states plainly
// which wins.
function loadVettedClaims() {
  try {
    const raw = fs.readFileSync(path.join(config.paths.data, 'vetted-claims.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      claims_precedence_note: parsed.instruction_to_model || null,
      vetted_claims: parsed.vetted_claims || [],
      excluded_claims: parsed.excluded_claims || [],
      flagged_inconsistencies: parsed.flagged_inconsistencies || [],
    };
  } catch {
    return null; // absent or unreadable — the profile is simply built without it
  }
}

function buildProfile(file, text) {
  const s = structure(text);
  const vetted = loadVettedClaims();
  return {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(file),
    sourceHash: hashFile(file),
    name: s.name,
    headline: s.headline,
    location: s.location,
    contact: { email: s.email, phone: s.phone, links: s.links },
    ...(vetted || {}),
    sections: s.sections,
    raw_text: text.trim(),
  };
}

function scaffoldPreferences(profile) {
  if (fs.existsSync(config.paths.preferences)) {
    log.info('preferences.md already exists — leaving it as is.');
    return false;
  }
  const inferredName = profile?.name || 'Dave Hettinger';
  const inferredLocation = profile?.location || 'Englewood, CO';
  const headline = profile?.headline || '';
  // Seed a couple of Adzuna queries from the resume headline when we have one,
  // otherwise fall back to broad defaults. Dave edits these.
  const querySeeds = headline
    ? [headline.toLowerCase(), 'national account manager', 'director sales']
    : ['financial analyst', 'sales'];
  const queryLines = querySeeds.map((q) => `adzuna_query: ${q}`).join('\n');
  const md = `# Missy — job search preferences

This file is yours to edit. The block below marked \`config\` is machine-read by
the pipeline; everything outside it is free text that Claude reads when scoring
and tailoring, so add nuance in plain language.

## Machine settings

Fill in the ATS slugs for companies you want to track. A slug is the last part
of a company's job-board URL, for example:
  greenhouse: boards.greenhouse.io/<slug>
  lever:      jobs.lever.co/<slug>
  ashby:      jobs.ashbyhq.com/<slug>

\`\`\`config
# Company ATS boards to pull (comma-separated or repeat the key)
greenhouse:
lever:
ashby:

# Adzuna keyword searches (one role per line)
${queryLines}

# Locations (a line reading "Remote" searches nationwide)
location: ${inferredLocation}
location: Remote

# Titles / seniority you are targeting (helps the rules filter)
title: analyst, associate, manager
seniority: mid, senior

# Hard filters
remote_ok: true
comp_floor: 90000
deal_breaker: unpaid, commission-only, door-to-door

# Federal jobs (USAJobs). Off by default.
include_federal: false
\`\`\`

## Target titles and seniority (free text)

${inferredName}${headline ? `, ${headline.toLowerCase()}` : ''}, based in
${inferredLocation}. Edit this paragraph to describe the roles you actually want
and the level you are targeting — the scorer reads it as your real preferences.
Add industries to favor or avoid, and any pivot you are making (for example
finance/analytics roles that draw on your P&L and pricing background).

## Must-haves

- Remote, or within commuting distance of ${inferredLocation}.

## Deal-breakers

- Unpaid or commission-only roles.

## Notes

Add anything else here that should shape which jobs rank highly — company size,
industries to favor or avoid, comp expectations, working style.
`;
  fs.mkdirSync(config.paths.inputs, { recursive: true });
  fs.writeFileSync(config.paths.preferences, md);
  log.info(`scaffolded ${path.relative(config.paths.root, config.paths.preferences)} — edit it before the first real run.`);
  return true;
}

async function establishSheet() {
  if (!has.sheets()) {
    log.info('google sheet not configured (SHEET_ID / service account) — skipping schema setup.');
    return;
  }
  try {
    const { ensureSheet } = await import('./lib/sheets.js');
    const res = await ensureSheet();
    if (res.enabled) log.info('google sheet schema is ready (Jobs tab + header).');
  } catch (e) {
    log.warn(`could not set up google sheet: ${e.message}`);
  }
}

export async function runIngest() {
  fs.mkdirSync(config.paths.data, { recursive: true });

  // Establish an empty state ledger if none exists (append-only from here).
  if (!fs.existsSync(config.paths.state)) {
    saveState(loadState());
    log.info('created state.json (append-only dedup ledger).');
  }

  const resume = findResume();
  let profile = null;

  if (!resume) {
    log.warn(
      'no resume found. Drop your resume at inputs/master-resume.docx or inputs/master-resume.pdf, then run `npm run ingest` again.',
    );
  } else {
    log.info(`parsing ${path.basename(resume)} ...`);
    const text = await extractText(resume);
    if (!text || text.trim().length < 40) {
      throw new Error('resume parsed but produced almost no text — is the file a scanned image? Try a text-based PDF or a .docx.');
    }
    profile = buildProfile(resume, text);
    fs.writeFileSync(config.paths.masterProfile, JSON.stringify(profile, null, 2));
    log.info(`wrote ${path.relative(config.paths.root, config.paths.masterProfile)} (${text.trim().length} chars of resume text).`);
  }

  // Scaffold preferences using whatever we inferred (works even with no resume).
  scaffoldPreferences(profile);

  await establishSheet();

  // Print the parsed profile for Dave to confirm.
  if (profile) {
    log.info('--- parsed profile (confirm before the pipeline tailors anything) ---');
    log.info(`name:    ${profile.name || '(not detected — set it in preferences.md notes)'}`);
    log.info(`email:   ${profile.contact.email || '(not detected)'}`);
    log.info(`phone:   ${profile.contact.phone || '(not detected)'}`);
    log.info(`links:   ${profile.contact.links.join(', ') || '(none)'}`);
    log.info(`sections detected: ${Object.keys(profile.sections).join(', ')}`);
    log.info('--- end profile ---');
    log.info('If this looks right, edit inputs/preferences.md (especially the config block), then run `npm run daily -- --dry-run`.');
  }

  return profile;
}

// Allow running this stage on its own: `npm run ingest`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runIngest().catch((e) => {
    console.error('[ingest] failed:', e.message);
    process.exit(1);
  });
}
