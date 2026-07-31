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

const ARCHETYPES_FOR_PROMPT = ['sales-planning', 'finance', 'national-accounts'];

let _client = null;
function client() {
  if (!_client) {
    if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey: config.anthropicKey });
  }
  return _client;
}

// Repairs raw control characters (literal newlines, tabs, etc.) that the
// model sometimes emits inside a JSON string value instead of escaping them
// as \n / \t — most common in long Markdown fields (tailorJob's resume/cover
// letter) where JSON.parse otherwise fails with "Bad control character in
// string literal". Walks the text tracking whether we're inside a string
// (respecting \" escapes) and only touches raw control bytes found there;
// structural JSON outside string literals is left untouched.
export function sanitizeJsonControlChars(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch.charCodeAt(0) < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

// Pull the first {...} JSON object out of a model response, tolerating any
// prose or code fences around it.
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in model response');
  }
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Retry once after repairing unescaped control characters — the common
    // failure mode for long Markdown string fields.
    return JSON.parse(sanitizeJsonControlChars(raw));
  }
}

function firstText(message) {
  const block = (message.content || []).find((b) => b.type === 'text');
  return block ? block.text : '';
}

// Parse a model response that is supposed to be a single JSON object, but
// report a truncated response as truncation rather than as malformed JSON.
//
// Worth the extra step because the two failure modes look nothing alike from
// the outside and were both hit in production: a response cut off by the
// max_tokens cap surfaces from extractJson() as either "no JSON object found
// in model response" (the closing brace never arrived) or "Expected ',' or
// ']' after array element" (cut mid-array) — neither of which points at the
// token budget, which is the thing that actually needs changing. Checking
// stop_reason first names the real cause in the log.
export function parseModelJson(message, label) {
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `${label}: response hit the max_tokens cap and was truncated — raise max_tokens for this call`,
    );
  }
  return extractJson(firstText(message));
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
    'do not inflate scores. Never invent qualifications the candidate lacks. Title/seniority-level ' +
    "mismatches are a scoring factor, not just a footnote: if the posting's title is clearly a tier " +
    "below the candidate's stated target level (e.g. a plain \"Manager\" posting when the candidate " +
    'targets Director/VP), reflect that in the numeric fit score itself — cap it well below 70 even ' +
    'if functional skills otherwise align well. Do not let strong functional overlap alone justify a ' +
    'high score when the seniority level does not match what the candidate is targeting.';

  // Split into a stable prefix (byte-identical across every job scored in one
  // run — profile, preferences, and feedback are fixed for the whole batch)
  // and a variable suffix (the one job posting). cache_control on the prefix
  // means only the first scoring call in a run pays full price for it; every
  // subsequent call in the same run reads it from cache (~0.1x cost) instead
  // of re-sending it. If the prefix is below the model's minimum cacheable
  // size this is a silent no-op — no error, no extra cost either way.
  const stablePrefix = [
    "CANDIDATE PROFILE (the only source of truth about the candidate's experience):",
    JSON.stringify(profile, null, 2),
    '',
    'CANDIDATE PREFERENCES (free text):',
    preferencesText || '(none provided)',
    '',
    feedbackBlock,
  ].join('\n');

  const variableSuffix = [
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
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variableSuffix },
        ],
      },
    ],
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
    '(6) Never pair a verified fact with an unverified or merely-adjacent one in the same phrase, ' +
    'bullet, or list item (e.g. do not write "X/Y Industry Background" or "X and Y experience" if ' +
    'only X is actually in the candidate profile) — an adjacent term the job posting mentions but the ' +
    'profile does not support must be left out entirely, even when it would sit next to something true. ' +
    'Return a strict JSON object.';

  // Same split as scoreJob: profile + preferences are identical across every
  // tailoring call in a run, so cache them once and pay full price only on
  // the first call — see the comment in scoreJob for the mechanics.
  const stablePrefix = [
    'CANDIDATE PROFILE (the only allowed source of facts):',
    JSON.stringify(profile, null, 2),
    '',
    'CANDIDATE PREFERENCES:',
    preferencesText || '(none provided)',
  ].join('\n');

  const variableSuffix = [
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
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variableSuffix },
        ],
      },
    ],
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

// --- Career-coach re-rank (Claude Haiku) ---
//
// Dave's own career-context brief carries a different evaluation lens than the
// generic scorer (sales-to-finance crossover positioning, standing strategic
// conclusions like "internal Daikin applications are highest-probability").
// This re-ranking is explicitly allowed to disagree with scoreJob()'s fit —
// that's the whole point of running it, not a bug to reconcile.
export async function rerankForCareerCoach({ jobs, brief }) {
  const system =
    "You are David Hettinger's personal career-coach re-ranking assistant. You are given his " +
    'full career-context brief (real background, resume methodology, and standing strategic ' +
    "conclusions) and a list of today's candidate job matches. Apply the brief's evaluation lens " +
    '(sales-to-finance crossover positioning) and its standing strategic conclusions to assign ' +
    'each job a candid percent fit rating. Be plain, not validating: fit degrades sharply when a ' +
    'posting drifts from commercial finance + pricing leadership, and a poor-fit archetype should ' +
    "be named and rated low rather than softened. This rating is allowed to disagree with any " +
    'other fit score already attached to a job — score independently from the brief\'s lens. ' +
    'Return a strict JSON object.';

  const stablePrefix = ['CAREER CONTEXT BRIEF (authoritative):', brief].join('\n');

  const variableSuffix = [
    '',
    "TODAY'S CANDIDATE MATCHES:",
    JSON.stringify(
      jobs.map((j) => ({
        id: j.id,
        company: j.company,
        title: j.title,
        location: j.location,
        remote: j.remote,
        scorerFit: j.fit,
        description: (j.description || '').slice(0, 2000),
      })),
      null,
      2,
    ),
    '',
    'Return ONLY this JSON object, no prose:',
    '{',
    '  "ranked": [',
    '    { "id": "<job id, exact string from above>", "fitPercent": <integer 0-100>, "verdict": "<one candid sentence>" }',
    '  ]',
    '}',
    'Include every job id exactly once, ordered best fit first.',
  ].join('\n');

  // One ranked entry (id + fitPercent + one-sentence verdict) costs roughly
  // 60-90 tokens once JSON structure is counted. A fixed 2000-token budget
  // was only ever safe for small shortlists — on 2026-07-30, 25 candidate
  // matches pushed the response past that cap, Claude's JSON got cut off
  // mid-array, and extractJson()'s JSON.parse failed ("Expected ',' or ']'
  // after array element"), which silently skipped career-coach review for
  // the entire day (caught deliberately below in career-coach.js so a
  // failure here never takes down the rest of the run — but that also means
  // it fails silent unless someone reads this log line). Scaling the budget
  // with jobs.length instead of a fixed guess is what actually fixes it,
  // since the match count varies run to run and will keep growing.
  const maxTokens = Math.min(8000, Math.max(2000, jobs.length * 150 + 500));

  const message = await client().messages.create({
    model: config.models.scorer,
    max_tokens: maxTokens,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variableSuffix },
        ],
      },
    ],
  });

  const parsed = parseModelJson(message, 'rerankForCareerCoach');
  const ranked = Array.isArray(parsed.ranked) ? parsed.ranked : [];
  return {
    ranked: ranked.map((r) => ({
      id: String(r.id || ''),
      fitPercent: Math.max(0, Math.min(100, Math.round(Number(r.fitPercent) || 0))),
      verdict: String(r.verdict || '').trim(),
    })),
    usage: message.usage,
  };
}

// --- Career-coach draft (Claude Sonnet) ---
//
// Same truthfulness discipline as tailorJob(), extended with the brief's own
// resume methodology (role-dependent archetype framing) and a mandatory gap
// analysis + open-items cross-check — Section 6 of the brief is a live list
// of unresolved data issues that must never be silently reused.
//
// `baselines` is a map of all three archetypes to their last-approved resume
// text (or null if none exists yet) — passed as a map, not a single guess,
// because the archetype for THIS job isn't known until the model picks it in
// this same call. Whichever one it picks, it needs the real prior wording to
// reuse (see the "reuse exact wording" rule below) — without this, career-
// coach.js's word-level diff against the baseline would show nearly the whole
// resume as changed on every run, since two independently-phrased drafts of
// the same facts rarely match word-for-word even when nothing substantive
// changed.
export async function careerCoachTailor({ job, brief, baselines = {} }) {
  const system =
    'You are David Hettinger\'s personal career-coach, producing a tailored, TRUTHFUL resume and ' +
    'cover letter draft for one job, following his own methodology exactly. Absolute rules: ' +
    '(1) Use ONLY facts present in the career-context brief\'s vetted accomplishments — never ' +
    'invent or embellish employers, titles, dates, degrees, or metrics, and never reuse a figure ' +
    'the brief marks as retired/unverified. (2) If the job asks for something the brief does not ' +
    'evidence, do not fake it — list it in "gaps" instead. (3) Pick exactly one resume archetype ' +
    'per the brief\'s own rule: "sales-planning" for Sales Planning-forward roles, "finance" for ' +
    'Finance roles (lead with FP&A and margin governance), or "national-accounts" for National ' +
    'Accounts roles (lead with the commercial story). (4) Perform the gap analysis line-by-line ' +
    'against the actual posting language, not generically. (5) Cross-check this specific draft ' +
    'against the brief\'s open-items checklist (Section 6) and flag any item this draft touches — ' +
    'do not silently use an unresolved figure or placeholder. (6) US-style resume, one to two ' +
    'pages. Short cover letter (200-300 words). No emojis. Sentence case. (7) A prior resume for ' +
    'each archetype is provided below where one exists. For whichever archetype you pick, reuse ' +
    "that prior resume's exact wording verbatim for any bullet describing the same underlying " +
    "fact or accomplishment — only change wording where this posting's language genuinely calls " +
    'for different emphasis or phrasing. The output is diffed against that prior resume afterward, ' +
    'and an unforced rewrite of unchanged content would bury the real changes in noise. ' +
    'Return a strict JSON object.';

  const stablePrefix = ['CAREER CONTEXT BRIEF (the only allowed source of facts):', brief].join('\n');

  const baselineBlock = ARCHETYPES_FOR_PROMPT.map((a) =>
    baselines[a]
      ? `PRIOR RESUME — ${a}:\n${baselines[a].slice(0, 6000)}`
      : `PRIOR RESUME — ${a}: none yet — this would be the first one for this archetype.`,
  ).join('\n\n');

  const variableSuffix = [
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
    baselineBlock,
    '',
    'Return ONLY this JSON object, no prose. Use Markdown inside the markdown string fields:',
    '{',
    '  "archetype": "<sales-planning|finance|national-accounts>",',
    '  "fit_percent": <integer 0-100, your own candid assessment>,',
    '  "verdict": "<one candid sentence>",',
    '  "resume_markdown": "<full tailored resume in Markdown, truthful, ready to edit>",',
    '  "cover_letter_markdown": "<short cover letter in Markdown>",',
    '  "gaps": [ { "requirement": "<exact requirement or phrase from the posting>", "note": "<why the current brief shows no evidence of this>" } ],',
    '  "open_items_flagged": [ { "item": "<short label of the Section 6 open item>", "note": "<why this draft touches it>" } ]',
    '}',
  ].join('\n');

  const message = await client().messages.create({
    model: config.models.tailor,
    // A full tailored resume AND a cover letter AND the gap/open-item arrays
    // all come back inside one JSON object here, so this needs materially more
    // headroom than tailorJob()'s 8000. At 8000 every call on 2026-07-31 was
    // truncated mid-resume and lost — the whole career-coach stage produced
    // nothing three days running.
    max_tokens: 16000,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variableSuffix },
        ],
      },
    ],
  });

  const parsed = parseModelJson(message, 'careerCoachTailor');
  const archetype = ['sales-planning', 'finance', 'national-accounts'].includes(parsed.archetype)
    ? parsed.archetype
    : 'finance';
  return {
    archetype,
    fitPercent: Math.max(0, Math.min(100, Math.round(Number(parsed.fit_percent) || 0))),
    verdict: String(parsed.verdict || '').trim(),
    resumeMarkdown: String(parsed.resume_markdown || '').trim(),
    coverLetterMarkdown: String(parsed.cover_letter_markdown || '').trim(),
    gaps: Array.isArray(parsed.gaps)
      ? parsed.gaps.map((g) => ({ requirement: String(g.requirement || ''), note: String(g.note || '') }))
      : [],
    openItemsFlagged: Array.isArray(parsed.open_items_flagged)
      ? parsed.open_items_flagged.map((o) => ({ item: String(o.item || ''), note: String(o.note || '') }))
      : [],
    usage: message.usage,
  };
}

// --- Interview prep (Claude Sonnet) ---
//
// The career-context brief's own title names "interview prep" as a thread
// this assistant covers — this is that extension. Same accuracy discipline
// as careerCoachTailor(): every suggested answer must trace to a vetted
// accomplishment in the brief, gaps get an honest talking point (never a
// fabricated one), and Section 6's open items are cross-checked again here —
// an unresolved figure that slipped through to the resume must not then get
// rehearsed as a confident interview answer.
export async function prepareInterview({ job, brief, resumeMarkdown, archetype }) {
  const system =
    'You are David Hettinger\'s personal interview-prep assistant, working from his own ' +
    'career-context brief and the resume actually used for this application. Absolute rules: ' +
    '(1) Every suggested talking point or STAR-format story must trace to a vetted ' +
    'accomplishment in the brief or the resume provided — never invent a detail, metric, or ' +
    'anecdote. (2) For any gap between the posting and the brief, write an honest talking ' +
    'point that acknowledges it plainly and bridges to adjacent real experience — never a ' +
    'fabricated claim of experience he does not have. (3) Cross-check against the brief\'s ' +
    'open-items checklist (Section 6) — if a suggested answer would rely on an unresolved or ' +
    'retired figure, flag it instead of rehearsing it as confident. (4) Questions should span ' +
    'behavioral, role-specific/technical, and culture-fit categories, grounded in the actual ' +
    'posting language. (5) No emojis. Sentence case. Return a strict JSON object.';

  const stablePrefix = ['CAREER CONTEXT BRIEF (the only allowed source of facts):', brief].join('\n');

  const variableSuffix = [
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
    `RESUME ACTUALLY USED FOR THIS APPLICATION (archetype: ${archetype || 'unknown'}):`,
    (resumeMarkdown || '').slice(0, 6000),
    '',
    'Return ONLY this JSON object, no prose:',
    '{',
    '  "likely_questions": [ { "question": "...", "category": "behavioral|role-specific|culture-fit" } ],',
    '  "star_stories": [ { "accomplishment": "<short label from the brief>", "situation": "...", "task": "...", "action": "...", "result": "..." } ],',
    '  "gap_talking_points": [ { "gap": "<what the posting asks for>", "honest_response": "<how to address it plainly, bridging to real adjacent experience>" } ],',
    '  "open_items_flagged": [ { "item": "<short label of the Section 6 open item>", "note": "<why an interview answer here would touch it>" } ],',
    '  "questions_to_ask": [ "..." ]',
    '}',
  ].join('\n');

  const message = await client().messages.create({
    model: config.models.tailor,
    max_tokens: 6000,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variableSuffix },
        ],
      },
    ],
  });

  const parsed = extractJson(firstText(message));
  return {
    likelyQuestions: Array.isArray(parsed.likely_questions)
      ? parsed.likely_questions.map((q) => ({ question: String(q.question || ''), category: String(q.category || '') }))
      : [],
    starStories: Array.isArray(parsed.star_stories)
      ? parsed.star_stories.map((s) => ({
          accomplishment: String(s.accomplishment || ''),
          situation: String(s.situation || ''),
          task: String(s.task || ''),
          action: String(s.action || ''),
          result: String(s.result || ''),
        }))
      : [],
    gapTalkingPoints: Array.isArray(parsed.gap_talking_points)
      ? parsed.gap_talking_points.map((g) => ({ gap: String(g.gap || ''), honestResponse: String(g.honest_response || '') }))
      : [],
    openItemsFlagged: Array.isArray(parsed.open_items_flagged)
      ? parsed.open_items_flagged.map((o) => ({ item: String(o.item || ''), note: String(o.note || '') }))
      : [],
    questionsToAsk: Array.isArray(parsed.questions_to_ask) ? parsed.questions_to_ask.map(String) : [],
    usage: message.usage,
  };
}
