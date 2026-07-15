// claude.js — the only place that talks to the Anthropic API.
//
// Free-before-paid is a hard rule: the rules filter runs first, then the cheap
// Haiku scorer on the shortlist, then the Sonnet tailor only on jobs that clear
// the threshold. This module exposes exactly two paid operations so the cost
// surface stays small and obvious:
//   - scoreJob():  Claude Haiku, fit score 0-100 + one-line rationale + keywords
//   - tailorJob(): Claude Sonnet, tailored resume + short cover letter
//
// Model ids are pinned in config (Haiku for scoring, Sonnet for tailoring),
// matching the spec's cost tiering.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let _client = null;
function client() {
  if (!_client) {
    if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey: config.anthropicKey });
  }
  return _client;
}

// Pull the first {...} JSON object out of a model response, tolerating any
// prose or code fences around it.
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function firstText(message) {
  const block = (message.content || []).find((b) => b.type === 'text');
  return block ? block.text : '';
}

// --- Scoring (Claude Haiku) ---
//
// `feedbackExamples` are recent rows Dave marked applied/passed/interview in the
// tracker sheet, passed in so scoring tracks his real taste over time. May be
// empty on a fresh sheet.
export async function scoreJob({ job, profile, preferencesText, feedbackExamples = [] }) {
  const feedbackBlock = feedbackExamples.length
    ? `Here is how Dave has recently reacted to jobs (his real taste — weight this heavily):\n` +
      feedbackExamples
        .map(
          (f) =>
            `- ${f.status.toUpperCase()}: ${f.title} at ${f.company}${
              f.location ? ` (${f.location})` : ''
            }`,
        )
        .join('\n')
    : 'No feedback history yet — score on the profile and preferences alone.';

  const system =
    'You are a careful job-fit rater for a single candidate. You compare one job posting to the ' +
    "candidate's real background and stated preferences and return a strict JSON object. Be honest: " +
    'do not inflate scores. Never invent qualifications the candidate lacks.';

  const user = [
    "CANDIDATE PROFILE (the only source of truth about the candidate's experience):",
    JSON.stringify(profile, null, 2),
    '',
    'CANDIDATE PREFERENCES (free text):',
    preferencesText || '(none provided)',
    '',
    feedbackBlock,
    '',
    'JOB POSTING:',
    JSON.stringify(
      {
        company: job.company,
        title: job.title,
        location: job.location,
        remote: job.remote,
        description: (job.description || '').slice(0, 6000),
      },
      null,
      2,
    ),
    '',
    'Return ONLY this JSON object, no prose:',
    '{',
    '  "fit": <integer 0-100, how well this job matches the candidate>,',
    '  "rationale": "<one sentence, plain language, why this score>",',
    '  "keywords": ["<up to 3 exact terms from the posting the resume should mirror>"]',
    '}',
  ].join('\n');

  const message = await client().messages.create({
    model: config.models.scorer,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const parsed = extractJson(firstText(message));
  const fit = Math.max(0, Math.min(100, Math.round(Number(parsed.fit) || 0)));
  return {
    fit,
    rationale: String(parsed.rationale || '').trim(),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 3).map(String) : [],
    usage: message.usage,
  };
}

// --- Tailoring (Claude Sonnet) ---
//
// Truthfulness is non-negotiable: tailoring reorders, reweights, and rephrases
// REAL content from the master profile only. It never invents employers,
// titles, dates, degrees, or metrics. If the job wants a skill Dave lacks, it
// is omitted, not fabricated.
export async function tailorJob({ job, profile, preferencesText }) {
  const system =
    'You are a professional resume and cover-letter writer producing tailored, TRUTHFUL documents ' +
    'for one candidate applying to one job. Absolute rules: (1) Use ONLY facts present in the ' +
    "candidate profile — never invent or embellish employers, titles, dates, degrees, or metrics. " +
    '(2) If the job asks for something the candidate does not have, simply omit it; do not fake it. ' +
    '(3) Reorder, reweight, and rephrase real experience to mirror the language of this posting. ' +
    '(4) US-style resume, one to two pages, standard professional conventions. Short cover letter ' +
    '(200-300 words). (5) No emojis. Sentence case in prose. No "business days" language. ' +
    'Return a strict JSON object.';

  const user = [
    'CANDIDATE PROFILE (the only allowed source of facts):',
    JSON.stringify(profile, null, 2),
    '',
    'CANDIDATE PREFERENCES:',
    preferencesText || '(none provided)',
    '',
    'JOB POSTING:',
    JSON.stringify(
      {
        company: job.company,
        title: job.title,
        location: job.location,
        remote: job.remote,
        description: (job.description || '').slice(0, 8000),
      },
      null,
      2,
    ),
    '',
    'Return ONLY this JSON object, no prose. Use Markdown inside the string fields:',
    '{',
    '  "resume_markdown": "<full tailored resume in Markdown, truthful, ready to edit>",',
    '  "cover_letter_markdown": "<short cover letter in Markdown>",',
    '  "covered_keywords": ["<key terms from the posting that the resume genuinely covers>"],',
    '  "missing_keywords": ["<key terms from the posting the candidate does NOT have — omitted, not faked>"]',
    '}',
  ].join('\n');

  const message = await client().messages.create({
    model: config.models.tailor,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const parsed = extractJson(firstText(message));
  return {
    resumeMarkdown: String(parsed.resume_markdown || '').trim(),
    coverLetterMarkdown: String(parsed.cover_letter_markdown || '').trim(),
    coveredKeywords: Array.isArray(parsed.covered_keywords)
      ? parsed.covered_keywords.map(String)
      : [],
    missingKeywords: Array.isArray(parsed.missing_keywords)
      ? parsed.missing_keywords.map(String)
      : [],
    usage: message.usage,
  };
}
