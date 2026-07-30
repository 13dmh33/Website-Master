'use strict';
/**
 * Hard gate against milly/templates/brand-voice.json's rules. Wired into
 * agents/scheduler.js — any post that fails does not reach Buffer or the
 * manual queue. Mirrors molly/lib/brand-validator.js's pattern (same repo,
 * sibling system) — Milly was the only live-posting content engine without
 * one before this.
 *
 * Deliberately narrower than Molly's validator: Milly's own brand-voice.json
 * explicitly ALLOWS pricing content (the scheduled "What Reeve Costs" post
 * names Scout/Pitch/Full prices directly on a 3-week cycle) — a Molly-style
 * "never state a price" rule would be wrong here and was NOT ported.
 *
 * NOT covered here, flagged instead of silently resolved: `ev-11`/`ev-12` in
 * templates/evergreen.json are documented as "social proof before real case
 * studies exist" — i.e. illustrative client-result-shaped content. Molly hit
 * an FTC-exposure incident over structurally similar fabricated client-result
 * posts. Adding a hard client-result check here would immediately reject
 * Milly's own existing evergreen posts without Dave's sign-off, so this was
 * deliberately left as a flagged decision rather than resolved unilaterally.
 *
 * Best-effort heuristic detection, not a full NLP solve — same tradeoff as
 * Molly's: false positives are the safe failure mode (a human can override by
 * hand-editing the post), false negatives are the one this is built to
 * minimize.
 */

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FOUNDER_NAME_PATTERNS = [/\bDave\b/, /David\s+Hettinger/i];

// From templates/brand-voice.json's avoid_words — includes Milly's own
// "never_mention_ai: true" rule (AI / automated / bot are all in this list).
const AVOID_WORDS = [
  'unlock', 'game-changer', 'supercharge', 'leverage', 'hustle',
  'crush it', 'kill it', 'dominate', 'hack', 'secret', 'AI', 'automated', 'bot',
];
const AVOID_WORD_PATTERN = new RegExp(
  '\\b(' + AVOID_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i',
);

// brand-voice.json: "cta_style": "soft — never pushy." — denylist of
// high-pressure phrasing rather than an allowlist of exact CTA text, since
// legitimate CTA wording varies by post (DM stages / DM audit / link in bio).
const PUSHY_CTA_PATTERN = /\b(act now|don't miss out|limited time|hurry|last chance|buy now|shop now|sale ends|only \d+ (left|spots|seats))\b/i;

function checkEmojis(text) {
  return EMOJI_PATTERN.test(text) ? ['contains an emoji'] : [];
}

function checkFounderName(text) {
  return FOUNDER_NAME_PATTERNS.some(p => p.test(text)) ? ['names the founder — Milly has no human persona'] : [];
}

function checkAvoidWords(text) {
  const match = text.match(AVOID_WORD_PATTERN);
  return match ? [`uses an avoid_words term ("${match[0]}") — see templates/brand-voice.json`] : [];
}

function checkPushyCta(text) {
  const match = text.match(PUSHY_CTA_PATTERN);
  return match ? [`CTA reads as high-pressure ("${match[0]}") — brand-voice.json calls for "soft — never pushy"`] : [];
}

function checkHashtagCount(text) {
  const count = (text.match(/#\w+/g) || []).length;
  if (count === 0) return []; // not every post format carries hashtags (e.g. Story)
  return count >= 3 && count <= 5 ? [] : [`hashtag count is ${count}, brand-voice.json calls for 3-5`];
}

/** Rough sentence-case check: flags ALL CAPS runs of 3+ words. */
function checkSentenceCase(text) {
  const words = text.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  const allCapsRun = words.filter(w => w.length > 2 && w === w.toUpperCase()).length;
  return allCapsRun >= 3 ? ['looks like ALL CAPS / not sentence case (3+ all-caps words)'] : [];
}

const CHECKS = [checkEmojis, checkFounderName, checkAvoidWords, checkPushyCta, checkHashtagCount, checkSentenceCase];

/**
 * validatePost(post) — checks post.caption against every rule. Returns
 * { pass, failures } — failures is a flat array of human-readable reasons,
 * empty when pass is true.
 */
function validatePost(post) {
  const text = String(post.caption || '');
  const failures = CHECKS.flatMap(check => check(text));
  return { pass: failures.length === 0, failures };
}

/** validateQueue(posts) — returns { passed, rejected } where rejected carries each post's failures. */
function validateQueue(posts) {
  const passed = [];
  const rejected = [];
  for (const post of posts) {
    const result = validatePost(post);
    if (result.pass) passed.push(post);
    else rejected.push({ post, failures: result.failures });
  }
  return { passed, rejected };
}

module.exports = { validatePost, validateQueue, CHECKS };
