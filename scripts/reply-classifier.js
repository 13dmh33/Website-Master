'use strict';
/**
 * Reply Classifier — determines intent of an inbound SMS or email reply
 *
 * Used by webhook.js (SMS) and poller.js (email) to decide how to update
 * lead status. Keyword-based — no API cost, instant results.
 *
 * Returns: { intent, confidence, notes }
 *
 * Intents:
 *   positive    → Lead is interested. Mark status "positive". mobile.js sends booking reply.
 *   question    → Lead asked something. Likely interested. Mark "positive" and flag for manual reply.
 *   objection   → Timing/budget objection ("not right now"). Mark "on_hold". Don't spam.
 *   negative    → Clear disinterest ("not interested"). Mark "unsubscribed".
 *   stop        → Explicit opt-out (STOP / UNSUBSCRIBE). Mark "unsubscribed" immediately.
 *   auto_reply  → Out-of-office or system-generated. Ignore.
 *   neutral     → No strong signal. Leave for manual review.
 *
 * Confidence: 'high' | 'medium' | 'low'
 */

// ── KEYWORD LISTS ─────────────────────────────────────────────────────────────

const STOP = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'
]);

const NEGATIVE_PHRASES = [
  'not interested', 'no thanks', 'no thank you', 'not for me',
  'wrong number', 'wrong person', 'don\'t contact', 'do not contact',
  'don\'t call', 'do not call', 'remove me', 'take me off',
  'leave me alone', 'go away', 'not looking', 'already have',
  'have a website', 'have one already', 'have someone', 'using someone',
  'covered', 'taken care of', 'not interested at this time'
];

const OBJECTION_PHRASES = [
  'not right now', 'not now', 'bad time', 'too busy',
  'busy season', 'maybe later', 'later on', 'in a few months',
  'next year', 'another time', 'not today', 'possibly later',
  'when things slow down', 'when i have time', 'not ready',
  'not yet', 'give me some time', 'check back', 'try me again',
  'call me back', 'reach out again'
];

const POSITIVE_PHRASES = [
  'interested', 'tell me more', 'more info', 'more information',
  'how much', 'what\'s the price', 'what is the price', 'pricing',
  'sounds good', 'sounds great', 'sounds interesting', 'love to',
  'would love', 'set up a call', 'let\'s talk', 'let\'s chat',
  'schedule', 'book a call', 'yes please', 'definitely',
  'absolutely', 'for sure', 'sign me up', 'where do i sign',
  'call me', 'can we talk', 'can we chat', 'can we meet',
  'send me', 'show me', 'what do you need', 'what\'s next',
  'how do we start', 'how does it work'
];

const QUESTION_STARTS = [
  'what', 'how', 'when', 'where', 'who', 'which', 'can you',
  'do you', 'does it', 'will it', 'would it', 'is it', 'are you'
];

const AUTO_REPLY_SUBJECTS = [
  'out of office', 'auto-reply', 'automatic reply', 'away from office',
  'on vacation', 'on leave', 'autoreply', 'auto response',
  'automated response', 'automatic response', 'i am out', 'i\'m out',
  'i am away', 'i\'m away', 'currently unavailable'
];

// ── HELPERS ───────────────────────────────────────────────────────────────────

function norm(text) {
  return (text || '').toLowerCase().replace(/['']/g, "'").trim();
}

function firstWord(text) {
  return norm(text).split(/\s+/)[0];
}

function containsAny(text, phrases) {
  return phrases.some(p => text.includes(p));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ── CLASSIFIER ────────────────────────────────────────────────────────────────

/**
 * @param {string} body       — reply body text (SMS body or email body)
 * @param {string} [subject]  — email subject line (optional)
 * @param {object} [headers]  — email headers map (optional, for auto-reply detection)
 * @returns {{ intent: string, confidence: string, notes: string }}
 */
function classify(body, subject = '', headers = null) {
  const text    = norm(body);
  const subj    = norm(subject);
  const first   = firstWord(text);
  const words   = wordCount(text);

  // ── 1. Auto-reply (email headers or subject line) ──────────────────────────
  if (headers) {
    const autoSubmitted = norm(headers.get?.('auto-submitted') || '');
    if (autoSubmitted && autoSubmitted !== 'no') {
      return result('auto_reply', 'high', 'Auto-Submitted header detected');
    }
    if (headers.get?.('x-autoreply') || headers.get?.('x-autorespond')) {
      return result('auto_reply', 'high', 'X-Autoreply header detected');
    }
  }
  if (containsAny(subj, AUTO_REPLY_SUBJECTS)) {
    return result('auto_reply', 'high', 'Out-of-office subject line');
  }

  // ── 2. Explicit STOP (first word, Twilio standard) ─────────────────────────
  if (STOP.has(first)) {
    return result('stop', 'high', `First word matches opt-out keyword: "${first}"`);
  }

  // ── 3. Negative ────────────────────────────────────────────────────────────
  if (containsAny(text, NEGATIVE_PHRASES)) {
    return result('negative', 'high', 'Matched negative-intent phrase');
  }

  // ── 4. Objection (soft rejection — timing, not permanent) ──────────────────
  if (containsAny(text, OBJECTION_PHRASES)) {
    return result('objection', 'medium', 'Matched objection phrase — bad timing, not disinterest');
  }

  // ── 5. Explicit positive ───────────────────────────────────────────────────
  if (containsAny(text, POSITIVE_PHRASES)) {
    return result('positive', 'high', 'Matched positive-intent phrase');
  }

  // ── 6. Question (implied interest) ─────────────────────────────────────────
  const isQuestion = text.includes('?') || QUESTION_STARTS.some(q => text.startsWith(q));
  if (isQuestion) {
    return result('question', 'medium', 'Contains question — likely interested, may need manual reply');
  }

  // ── 7. Short reply with no negative signals — lean positive ────────────────
  // "Ok", "Sure", "Sounds good", "Yeah"
  const hasNegative = text.includes(' no ') || text.startsWith('no ') || text.includes("n't");
  if (words <= 5 && !hasNegative) {
    return result('positive', 'low', `Short reply (${words} word${words === 1 ? '' : 's'}), no negative signals — likely positive, verify before acting`);
  }

  // ── 8. Neutral / unclear ───────────────────────────────────────────────────
  return result('neutral', 'low', 'No strong signals — flag for manual review');
}

function result(intent, confidence, notes) {
  return { intent, confidence, notes };
}

// ── STATUS MAPPING ────────────────────────────────────────────────────────────
// Maps classifier intent to the status written to messages/*-sent.json

const STATUS_MAP = {
  positive:   'positive',     // mobile.js sends booking reply
  question:   'positive',     // mobile.js sends booking reply; also needs manual note
  objection:  'on_hold',      // no auto-reply; drip paused; revisit later
  negative:   'unsubscribed', // no further contact
  stop:       'unsubscribed', // no further contact
  auto_reply: null,           // ignore — don't update status
  neutral:    null            // ignore — leave for manual review
};

function statusFor(intent) {
  return STATUS_MAP[intent] ?? null;
}

// ── CLI TEST MODE ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const samples = [
    'STOP',
    'Not interested',
    'No thanks',
    'Not right now, maybe in a few months',
    'How much does it cost?',
    'Sounds interesting, tell me more',
    'Yes I would love to learn more',
    'Ok',
    'Sure',
    'Wrong number',
    'I already have someone handling my website',
    'What exactly is included?',
    'We are covered, thanks',
    'Call me back when things slow down',
    'Absolutely, let\'s set something up',
  ];

  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nReply Classifier — Test Run');
  console.log('─'.repeat(80));
  console.log(`${pad('Input', 40)} ${pad('Intent', 12)} ${pad('Confidence', 10)} Notes`);
  console.log('─'.repeat(80));
  for (const s of samples) {
    const r = classify(s);
    const status = statusFor(r.intent) ?? '(no action)';
    console.log(`${pad(s.slice(0, 38), 40)} ${pad(r.intent, 12)} ${pad(r.confidence, 10)} → ${status}`);
  }
  console.log('─'.repeat(80));
  console.log('');
}

module.exports = { classify, statusFor };
