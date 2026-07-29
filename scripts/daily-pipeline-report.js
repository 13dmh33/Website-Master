#!/usr/bin/env node
/**
 * Daily lead-gen pipeline report + silent-failure audit.
 *
 * The failure mode this exists to kill: an unattended chain that "succeeds"
 * while producing nothing. Scout finds a market already exhausted, or
 * contact-scraper harvests zero emails, and every stage still exits 0. Nobody
 * notices for days. Merlin's frozen-stage findings are exactly this shape.
 *
 * Design choice: this emails on EVERY run, not just failures. If Dave gets no
 * mail at 7am, that means the job never fired at all — which is itself the
 * alert. A failure-only notifier cannot distinguish "healthy" from "dead".
 *
 * Reads a results JSON written by scripts/daily-lead-gen.sh:
 *   { date, city, trade, stages: { scout: {...}, scrape: {...}, ... },
 *     readyToSend, rotation: { done, remaining } }
 *
 * Usage:
 *   node scripts/daily-pipeline-report.js logs/daily-lead-gen/2026-07-29.json
 *   node scripts/daily-pipeline-report.js <file> --dry-run   # print, don't email
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const nodemailer = require('nodemailer');

const RECIPIENT = process.env.REPORT_TO_EMAIL || process.env.ZOHO_EMAIL;

/**
 * Classify a run. Order matters — a hard failure outranks a zero-yield, and an
 * exhausted rotation is its own state because the fix is different (open a new
 * state / add trades) rather than "investigate the scraper".
 */
function classify(r) {
  const problems = [];
  if (r.error) return { status: 'FAILED', problems: [r.error] };
  if (r.rotationExhausted) {
    return {
      status: 'EXHAUSTED',
      problems: ['Every city x trade combination in the rotation is worked. Add markets or trades.'],
    };
  }

  const s = r.stages || {};
  if ((s.scout?.newLeads ?? 0) === 0) {
    problems.push('Scout returned no new leads — market may be exhausted or filters too tight.');
  }
  if ((s.scrape?.emailsFound ?? 0) === 0) {
    problems.push('Contact-scraper harvested no emails — sites may be blocking, or none publish an address.');
  }
  if ((s.checker?.approved ?? 0) === 0) {
    problems.push('Checker approved nothing — messages are failing evals, or nothing reached it.');
  }
  if ((r.readyToSend ?? 0) === 0) {
    problems.push('Zero email-ready leads produced. The pipeline ran but added no sendable contacts.');
  }

  return { status: problems.length ? 'DEGRADED' : 'OK', problems };
}

function buildSubject(r, verdict) {
  const target = r.city && r.trade ? `${r.trade} / ${r.city}` : 'no target';
  const n = r.batch?.count ?? r.readyToSend ?? 0;
  // Subject leads with the action, because this mail exists to be acted on.
  if (verdict.status === 'OK')        return `Approve ${n} contacts — ${target}`;
  if (verdict.status === 'DEGRADED')  return `Lead-gen DEGRADED — ${n} to approve (${target})`;
  if (verdict.status === 'EXHAUSTED') return 'Lead-gen EXHAUSTED — rotation has no markets left';
  return `Lead-gen FAILED — ${target}`;
}

function buildBody(r, verdict) {
  const s = r.stages || {};
  const lines = [
    `Daily lead-gen — ${r.date || '(no date)'}`,
    `Status:  ${verdict.status}`,
    `Target:  ${r.trade || '?'} in ${r.city || '?'}`,
    '',
    'Stages',
    `  Scout           new leads:      ${s.scout?.newLeads ?? 'n/a'}`,
    `  Contact-scraper emails found:   ${s.scrape?.emailsFound ?? 'n/a'}`,
    `  Diagnoser       briefs written: ${s.diagnoser?.briefs ?? 'n/a'}`,
    `  Checker         approved:       ${s.checker?.approved ?? 'n/a'}`,
    `  Sheet-log       rows synced:    ${s.sheetLog?.rows ?? 'n/a'}`,
    '',
    `Email-ready leads now waiting to send: ${r.readyToSend ?? 'n/a'}`,
  ];

  if (r.rotation) {
    lines.push(`Rotation: ${r.rotation.done}/${r.rotation.done + r.rotation.remaining} combinations worked, ${r.rotation.remaining} remaining.`);
  }
  if (r.spend != null) lines.push(`Outscraper spend this run: $${Number(r.spend).toFixed(3)}`);

  if (r.sentToday != null) {
    lines.push('', `Emails sent this morning (previously approved batch): ${r.sentToday}`);
  }

  if (verdict.problems.length) {
    lines.push('', 'Needs attention');
    verdict.problems.forEach(p => lines.push(`  - ${p}`));
  }

  // The contact list is the point of this email — Dave approves from here.
  const batchLeads = r.batchLeads || [];
  if (batchLeads.length) {
    lines.push(
      '',
      '─────────────────────────────────────────────',
      `AWAITING YOUR APPROVAL — ${batchLeads.length} contacts scraped ${r.date}`,
      '─────────────────────────────────────────────',
    );
    batchLeads.forEach((l, i) => {
      lines.push(`${String(i + 1).padStart(3)}. ${l.business_name || '(no name)'}`);
      lines.push(`     ${l.email}${l.city ? '   ·   ' + l.city : ''}`);
    });
    lines.push(
      '',
      'Nothing above has been emailed. Approve to send on the next 6:30am run:',
      `  node scripts/approve-batch.js ${r.date}`,
      '',
      'Or reject the whole batch:',
      `  node scripts/approve-batch.js ${r.date} --reject`,
      '',
      'Left un-approved, this batch never sends.',
    );
  } else if (verdict.status !== 'EXHAUSTED' && verdict.status !== 'FAILED') {
    lines.push('', 'No new contacts to approve today.');
  }

  lines.push(
    '',
    'This report is sent on every run. No report at all means the scheduled job did not fire.',
  );
  return lines.join('\n');
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node scripts/daily-pipeline-report.js <results.json> [--dry-run]');
    process.exit(1);
  }

  let results;
  try {
    results = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // A missing/corrupt results file is itself a failure worth reporting.
    results = { error: `Could not read results file ${file}: ${e.message}` };
  }

  const verdict = classify(results);
  const subject = buildSubject(results, verdict);
  const body = buildBody(results, verdict);

  console.log(`[report] ${subject}`);
  console.log(body);

  if (dryRun) {
    console.log('\n[report] --dry-run — no email sent.');
    return;
  }
  if (!process.env.ZOHO_EMAIL || !process.env.ZOHO_APP_PASSWORD) {
    console.error('[report] ZOHO_EMAIL / ZOHO_APP_PASSWORD not set — cannot send. Report printed above.');
    process.exitCode = 1;
    return;
  }

  const transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user: process.env.ZOHO_EMAIL, pass: process.env.ZOHO_APP_PASSWORD },
  });
  await transport.sendMail({
    from: `"Trevo lead-gen" <${process.env.ZOHO_EMAIL}>`,
    to: RECIPIENT,
    subject,
    text: body,
  });
  console.log(`[report] emailed ${RECIPIENT}`);
}

module.exports = { classify, buildSubject, buildBody };

if (require.main === module) {
  main().catch(err => {
    console.error(`[report] failed: ${err.message}`);
    process.exit(1);
  });
}
