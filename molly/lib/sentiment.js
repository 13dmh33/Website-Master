'use strict';

// sentiment.js — comment/DM sentiment mining for Trevo Advisors (Molly).
//
// Molly's Analyst only reads engagement metrics (likes/saves/profile visits) —
// this adds a qualitative signal (what contractors actually say in comments/DMs)
// by running a cheap Claude classification pass over exported comment text.
// Ingestion is manual-export only for now: drop a file at
// output/comments/latest.json shaped like
//   { "weekOf": "...", "comments": [ { "text": "...", "postId": "..." } ] }
// Comment volume is small, so one batched Claude call per week is cheap.

const claude = require('./claude');

const SYSTEM_PROMPT = `
You classify Instagram comments/DMs for Trevo Advisors, a website agency serving home
service contractors (plumbers, electricians, handymen). For each comment, decide:
- sentiment: "positive" | "negative" | "neutral"
- reason: one of "interest_in_service" | "pricing_question" | "skepticism" | "complaint" | "other"
Be terse. Don't editorialize beyond the classification.
`.trim();

function buildPrompt(comments) {
  const listed = comments
    .map((c, i) => `${i}. "${c.text}"`)
    .join('\n');
  return `Classify these ${comments.length} comments. Return ONLY valid JSON, no markdown:
{ "results": [ { "index": 0, "sentiment": "positive", "reason": "interest_in_service" }, ... ] }

Comments:
${listed}`;
}

// classify a batch of comments ({ text, postId }[]) → adds sentiment + reason to each
async function classifyComments(comments) {
  if (!comments || !comments.length) return [];

  const raw = await claude.call({
    prompt: buildPrompt(comments),
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: Math.max(300, comments.length * 40),
  });
  const parsed = claude.parseJson(raw);
  const results = parsed.results || [];

  return comments.map((c, i) => {
    const r = results.find(r => r.index === i) || {};
    return { ...c, sentiment: r.sentiment || 'neutral', reason: r.reason || 'other' };
  });
}

// aggregate classified comments into counts by sentiment and by reason
function summarize(classified) {
  const bySentiment = { positive: 0, negative: 0, neutral: 0 };
  const byReason = {};
  for (const c of classified) {
    bySentiment[c.sentiment] = (bySentiment[c.sentiment] || 0) + 1;
    byReason[c.reason] = (byReason[c.reason] || 0) + 1;
  }
  return { total: classified.length, bySentiment, byReason };
}

module.exports = { classifyComments, summarize };
