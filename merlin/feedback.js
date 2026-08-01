#!/usr/bin/env node
'use strict';
/**
 * merlin/feedback.js — tell Merlin its report was off.
 *
 * Run this from a session (or by hand) whenever a recommendation turns out to
 * be stale, wrong, or not worth doing. Merlin reads the log on its next run:
 * suppressing verdicts drop the item from the ranked pool, and every entry
 * feeds an accuracy scorecard printed in the report.
 *
 *   node merlin/feedback.js add_stripe_key already-done "Payment Links live since 6db94f9; no secret key involved"
 *   node merlin/feedback.js investigate_biggest_dropoff good "Real finding, led to the actionable-backlog fix"
 *   node merlin/feedback.js add_stripe_key reinstate "Stripe flow changed, re-evaluate"
 *   node merlin/feedback.js --list
 *   node merlin/feedback.js --accuracy
 *
 * Advisor-only, same as the rest of Merlin: this writes one JSON file under
 * merlin/ and nothing else.
 */

const { loadFeedback, recordFeedback, VERDICTS, isValidVerdict } = require('./lib/feedback');

function usage() {
  const verdicts = Object.entries(VERDICTS)
    .map(([name, v]) => `    ${name.padEnd(15)} ${v.label}${v.suppresses ? ' (suppresses it)' : ''}`)
    .join('\n');
  return `Tell Merlin a recommendation was off, so it stops repeating it and tracks its own accuracy.

Usage:
  node merlin/feedback.js <candidate-id> <verdict> [note]
  node merlin/feedback.js --list
  node merlin/feedback.js --accuracy

Verdicts:
${verdicts}

The candidate id is the id shown in Merlin's report backlog (for example
add_stripe_key), not the human label.`;
}

function renderAccuracy(fb) {
  const a = fb.accuracy();
  if (a.rated === 0) return 'No feedback recorded yet — nothing to score.';
  const lines = [
    `Merlin accuracy: ${a.accuracyPct}% (${a.good} good, ${a.off} off, ${a.rated} rated)`,
  ];
  for (const [verdict, count] of Object.entries(a.offByReason)) {
    lines.push(`  ${verdict}: ${count}`);
  }
  if (fb.suppressedIds.size > 0) {
    lines.push('', 'Currently suppressed:');
    for (const [id, e] of fb.suppressedIds) {
      lines.push(`  ${id} — ${e.verdict}${e.note ? `: ${e.note}` : ''}`);
    }
  }
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(usage());
    return 0;
  }

  const fb = loadFeedback();

  if (args[0] === '--accuracy') {
    console.log(renderAccuracy(fb));
    return 0;
  }

  if (args[0] === '--list') {
    if (fb.entries.length === 0) {
      console.log('No feedback recorded yet.');
      return 0;
    }
    for (const e of fb.entries) {
      console.log(`${e.recordedAt.slice(0, 10)}  ${e.id}  ${e.verdict}${e.note ? `  — ${e.note}` : ''}`);
    }
    return 0;
  }

  const [id, verdict, ...noteParts] = args;
  if (!verdict) {
    console.error('Missing verdict.\n');
    console.error(usage());
    return 1;
  }
  if (!isValidVerdict(verdict)) {
    console.error(`Unknown verdict "${verdict}". Expected one of: ${Object.keys(VERDICTS).join(', ')}`);
    return 1;
  }

  const record = recordFeedback({ id, verdict, note: noteParts.join(' ') });
  const suppresses = VERDICTS[verdict].suppresses;
  console.log(`Recorded: ${record.id} — ${record.verdict}${record.note ? ` (${record.note})` : ''}`);
  console.log(
    suppresses
      ? 'Merlin will stop recommending this on its next run.'
      : verdict === 'reinstate'
        ? 'Suppression lifted — Merlin may recommend this again.'
        : 'Counted toward Merlin\'s accuracy score.',
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main, usage, renderAccuracy };
