'use strict';
/**
 * Hard gate against molly/CLAUDE.md's brand-voice rules. Wired into
 * scripts/push-queue.js — any post that fails does not reach Buffer.
 *
 * Best-effort heuristic detection, not a full NLP solve — false positives
 * are the safe failure mode here (a human can override by hand-editing the
 * post), false negatives are the one this is built to minimize. Every
 * check is a pure function over a caption/body string so it's directly
 * testable and auditable against real examples.
 */

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const BOT_PATTERN = /\bbot\b/i;
const BUSINESS_DAYS_PATTERN = /business\s+days?/i;
const FOUNDER_NAME_PATTERNS = [/\bDave\b/, /David\s+Hettinger/i];
const PRICE_PATTERN = /\$\s?\d/;

// Allowed delivery-timing phrase, sparing use — everything else time-promise-shaped fails.
const ALLOWED_DELIVERY_PHRASE = /in as little as two days/i;
const DELIVERY_PROMISE_PATTERN = /\b(\d+[\s-]?(hour|hr|day)s?\b|same[\s-]day|next[\s-]day|overnight|instant(ly)?|24[\s-]?hours?|48[\s-]?hours?)/i;

// Statistic-shaped patterns needing a source; approved sources allow it through.
// Broad on purpose: any specific quantified claim (percentages, ratios, or a
// plain number attached to a countable business-relevant noun) needs a source.
const STAT_SHAPE_PATTERN = /\d+(\.\d+)?\s?(%|percent|x\b)|\b\d+(-\d+)?\s?(out of|in)\s?\d+|\b\d+(\.\d+)?[\s-]?(stars?|reviews?|seconds?|minutes?|hours?|calls?|jobs?|customers?|leads?|clicks?|visits?|submissions?|ratings?|times)\b/i;
const APPROVED_SOURCES = /BrightLocal|Think with Google|Pew Research|\bSBA\b|\bBBB\b|U\.?S\.? Census|\bBLS\b|ServiceTitan|Housecall Pro|\bJobber\b/i;
const YEAR_PATTERN = /\b20\d{2}\b/;

// Not exhaustive — a starting denylist of major-metro city names that showed up
// in the quarantined content; extend as new violations are found.
const CITY_PATTERN = /\b(Denver|Phoenix|Austin|Houston|Dallas|Chicago|Seattle|Portland|Atlanta|Boston|Miami|Nashville|Charlotte|Columbus|Indianapolis|Detroit|Memphis|Baltimore|Milwaukee|Albuquerque|Tucson|Fresno|Sacramento|Kansas City|Omaha|Raleigh|Tampa|Orlando|Colorado Springs)\b/i;

// Client-result-shaped: a specific outcome number tied to a result word, no way to
// verify consent from text alone — treated as a hard fail per "no client results
// until there is a real client who has consented."
const CLIENT_RESULT_PATTERN = /\b\d+\s?(new\s)?(jobs?|customers?|reviews?|leads?|submissions?)\b.{0,40}\b(week|month|day|first \d+ days)/i;

function checkEmojis(text) {
  return EMOJI_PATTERN.test(text) ? ['contains an emoji'] : [];
}

function checkBot(text) {
  return BOT_PATTERN.test(text) ? ['says "bot" — must say "AI agent"'] : [];
}

function checkBusinessDays(text) {
  return BUSINESS_DAYS_PATTERN.test(text) ? ['contains "business day(s)" language'] : [];
}

function checkFounderName(text) {
  return FOUNDER_NAME_PATTERNS.some(p => p.test(text)) ? ['names the founder'] : [];
}

function checkPrice(text) {
  return PRICE_PATTERN.test(text) ? ['states a price — pricing stays off social entirely'] : [];
}

function checkDeliveryPromise(text) {
  const withoutAllowed = text.replace(ALLOWED_DELIVERY_PHRASE, '');
  return DELIVERY_PROMISE_PATTERN.test(withoutAllowed)
    ? ['contains a hard delivery-time promise beyond "in as little as two days"']
    : [];
}

function checkUnsourcedStatistic(text) {
  if (!STAT_SHAPE_PATTERN.test(text)) return [];
  const hasSource = APPROVED_SOURCES.test(text);
  const hasYear = YEAR_PATTERN.test(text);
  return (hasSource && hasYear) ? [] : ['contains a statistic-shaped figure without a visible approved source and year'];
}

function checkCityReference(text) {
  const match = text.match(CITY_PATTERN);
  return match ? [`references a city ("${match[0]}") — national targeting only, no city or region`] : [];
}

function checkClientResult(text) {
  return CLIENT_RESULT_PATTERN.test(text)
    ? ['reads as a specific client result — not allowed until a real client has consented']
    : [];
}

/** Rough sentence-case check: flags ALL CAPS runs of 3+ words (title-case-every-word or shouting). */
function checkSentenceCase(text) {
  const words = text.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  const allCapsRun = words.filter(w => w.length > 2 && w === w.toUpperCase()).length;
  return allCapsRun >= 3 ? ['looks like ALL CAPS / not sentence case (3+ all-caps words)'] : [];
}

const CHECKS = [
  checkEmojis, checkBot, checkBusinessDays, checkFounderName, checkPrice,
  checkDeliveryPromise, checkUnsourcedStatistic, checkCityReference,
  checkClientResult, checkSentenceCase,
];

/**
 * validatePost(post) — checks post.caption (and post.hook/post.body/post.cta if
 * present) against every rule. Returns { pass, failures } — failures is a flat
 * array of human-readable reasons, empty when pass is true.
 */
function validatePost(post) {
  const text = [post.caption, post.hook, post.body, post.cta, post.donation]
    .filter(Boolean)
    .join('\n');

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
