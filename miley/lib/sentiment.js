'use strict';

// sentiment.js — comment/DM sentiment mining (#8).
//
// The Analyst's sales signal only reads UTM click data (which product people
// buy) — this adds a qualitative signal (what people actually say) by running
// a cheap Claude classification pass over exported comment/DM text. Ingestion
// is manual-export only for now: drop a file at output/comments/latest.json
// shaped like { "weekOf": "...", "comments": [ { "text": "...", "postId": "..." } ] }
// (same pattern as output/clicks/latest.json). Comment volume is small, so one
// batched Claude call per week is cheap.

const claude = require('./claude');

const SYSTEM_PROMPT = `
You classify Instagram comments/DMs for Techs4Tatas, an apparel brand celebrating women in the
skilled trades where 30% of profit funds breast cancer research. For each comment, decide:
- sentiment: "positive" | "negative" | "neutral"
- reason: one of "joke_landed" | "donation_resonated" | "product_desire" | "complaint" | "other"
Be terse. Don't editorialize beyond the classification.
`.trim();

function buildPrompt(comments) {
  const listed = comments
    .map((c, i) => `${i}. "${c.text}"`)
    .join('\n');
  return `Classify these ${comments.length} comments. Return ONLY valid JSON, no markdown:
{ "results": [ { "index": 0, "sentiment": "positive", "reason": "joke_landed" }, ... ] }

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
