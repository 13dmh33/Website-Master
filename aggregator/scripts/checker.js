#!/usr/bin/env node
/**
 * Aggregator Checker — local-only eval profile "aggregator", isolated from
 * the existing Checker (scripts/checker.js) and its no-website / audit-pitch
 * profiles. Gates drafted lane copy in aggregator/outreach-queue/ before it's
 * considered ready to queue. No API calls — copy is templated, not
 * AI-generated, so a rewrite loop isn't needed; failures get flagged for a
 * human edit to the template instead.
 *
 * Usage:
 *   node aggregator/scripts/checker.js          (preview, no writes)
 *   node aggregator/scripts/checker.js --write  (writes checker_approved/checker_flag)
 *
 * Reads:  aggregator/outreach-queue/*.json (drafted sequences)
 * Writes: aggregator/outreach-queue/*.json (checker_approved, checker_flag, failures per step)
 */

const fs = require('fs');
const path = require('path');

const QUEUE_DIR = path.join(__dirname, '..', 'outreach-queue');

const args = process.argv.slice(2);
const doWrite = args.includes('--write');

// ── EVALS (profile: aggregator) ──────────────────────────────────────────────

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FOUNDER_NAMES = ['dave', 'david hettinger', 'david m hettinger'];

// Lane-bleed: words that should only appear in their own lane's copy.
const LANE_EXCLUSIVE_WORDS = {
  license_prep: ['affiliate'],
  bonding_insurance: ['bond', 'bonding', 'surety', 'insurance agent'],
  sbdc_score: ['sbdc', 'score chapter', 'advising packet'],
  trade_school: ['guest session']
};

function evalNoEmojis(text) {
  return { pass: !EMOJI_RE.test(text) };
}

function evalNoFounderName(text) {
  const lower = text.toLowerCase();
  const found = FOUNDER_NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(lower));
  return { pass: found.length === 0, found };
}

function evalNoBusinessDays(text) {
  return { pass: !/business days?/i.test(text) };
}

function evalNoPriceInE1(step, sourceType) {
  if (step.step !== 'e1') return { pass: true, skipped: true };
  if (!['license_prep', 'sbdc_score', 'trade_school'].includes(sourceType)) return { pass: true, skipped: true };
  const body = step.body;
  const negatedCost = /\bno cost\b|\bat no cost\b|\bfree\b/i.test(body);
  const hasDollar = /\$\s?\d/.test(body);
  const hasPriceWord = /\bprice\b/i.test(body);
  const hasUnnegatedCostWord = /\bcost\b|\bfee\b/i.test(body) && !negatedCost;
  return { pass: !(hasDollar || hasPriceWord || hasUnnegatedCostWord) };
}

// Heuristic: count distinct CTA action groups. "Reply X, or I'll Y" is one
// CTA (single action: reply); a second, unrelated imperative is a violation.
function evalOneCta(text) {
  const ctaGroups = [/\breply\b/i, /\bbook\b/i, /\bschedule\b/i, /\bcall me\b/i, /\bclick here\b/i];
  const hits = ctaGroups.filter((re) => re.test(text)).length;
  return { pass: hits <= 1, ctaGroupsFound: hits };
}

function evalNoLaneBleed(text, sourceType) {
  const bleed = [];
  for (const [lane, words] of Object.entries(LANE_EXCLUSIVE_WORDS)) {
    if (lane === sourceType) continue;
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`, 'i').test(text)) bleed.push(w);
    }
  }
  return { pass: bleed.length === 0, bleed };
}

function evalAffiliateFramingLane1E2(step, sourceType) {
  if (sourceType !== 'license_prep' || step.step !== 'e2') return { pass: true, skipped: true };
  return { pass: /affiliate/i.test(step.body) };
}

function evalReciprocityNotStudentLane2(text, sourceType) {
  if (sourceType !== 'bonding_insurance') return { pass: true, skipped: true };
  const hasStudent = /\bstudent\b/i.test(text);
  const hasReciprocity = /\breferral\b|\brefer\b|\bsend.*your way\b|\btwo-way\b/i.test(text);
  return { pass: !hasStudent && hasReciprocity, hasStudent, hasReciprocity };
}

function runEvalsForStep(step, sourceType) {
  const fullText = `${step.subject}\n${step.body}`;
  const evals = {
    no_emojis: evalNoEmojis(fullText),
    no_founder_name: evalNoFounderName(fullText),
    no_business_days: evalNoBusinessDays(fullText),
    no_price_in_e1: evalNoPriceInE1(step, sourceType),
    one_cta: evalOneCta(step.body),
    no_lane_bleed: evalNoLaneBleed(fullText, sourceType),
    affiliate_framing_lane1_e2: evalAffiliateFramingLane1E2(step, sourceType),
    reciprocity_not_student_lane2: evalReciprocityNotStudentLane2(fullText, sourceType)
  };
  const failures = Object.entries(evals).filter(([, v]) => !v.pass).map(([k]) => k);
  return { evals, failures, allPass: failures.length === 0 };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log('No aggregator/outreach-queue/ directory found — run email-sequences.js --write first.');
    return;
  }

  const files = fs.readdirSync(QUEUE_DIR).filter((f) => f.endsWith('.json') && f !== 'replies.json');
  let approvedSteps = 0;
  let flaggedSteps = 0;

  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);
    const draft = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (draft.reply_exit) continue;

    for (const step of draft.sequence) {
      if (step.status === 'cancelled_reply_exit') continue;
      const result = runEvalsForStep(step, draft.source_type);
      if (result.allPass) {
        step.checker_approved = true;
        step.checker_flag = '';
        step.status = doWrite ? 'queued' : step.status;
        approvedSteps++;
      } else {
        step.checker_approved = false;
        step.checker_flag = 'human_review';
        step.checker_failures = result.failures;
        flaggedSteps++;
        console.log(`  FLAG ${file} [${step.step}]: ${result.failures.join(', ')}`);
      }
    }

    if (doWrite) fs.writeFileSync(filePath, JSON.stringify(draft, null, 2));
  }

  console.log(`Aggregator Checker — ${approvedSteps} step(s) approved, ${flaggedSteps} flagged for human review.`);
  if (!doWrite) console.log('  Run with --write to persist checker_approved/status to queue files.');
}

main();
