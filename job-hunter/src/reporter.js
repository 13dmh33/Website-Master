// reporter.js — Stage 5. Build the digest, email it, and log to the sheet.
//
// The digest is the whole point: a review-only summary Dave acts on manually.
// It is never sent to any employer or job site. For each match it shows company,
// title, location, blended score (with raw fit + freshness bonus broken out),
// age, rationale, the apply link, links to the tailored docs, an ATS
// keyword-coverage line, and a "new since last run" flag.
//
// Also (unless --dry-run): appends one row per match to the Google Sheet tracker
// and records the delivered job ids in state.json so nothing repeats.
//
// Optional instant alert: if INSTANT_ALERT_MIN is set and a job is both high-fit
// and posted <24h, fire a one-off email immediately (once per job).

import { config, has } from './lib/config.js';
import { makeLogger } from './lib/log.js';
import { ageLabel, ageDays } from './lib/recency.js';
import { appendRows, ensureSheet } from './lib/sheets.js';
import { sendDigest } from './lib/email.js';
import { recordDigest, hasSentInstant, markInstant } from './lib/state.js';

const log = makeLogger('reporter');

function coverageLine(job) {
  const covered = job.deliverables?.coveredKeywords?.length || 0;
  const missing = job.deliverables?.missingKeywords?.length || 0;
  const total = covered + missing;
  if (!total) return 'keyword coverage not available';
  return `covers ${covered}/${total} key terms from the posting`;
}

function textDigest(matches, now) {
  const lines = [];
  lines.push(`Missy job digest — ${now.toISOString().slice(0, 10)}`);
  lines.push(`${matches.length} match${matches.length === 1 ? '' : 'es'} to review. Nothing has been applied to — this is for your manual review.`);
  lines.push('');
  matches.forEach((job, i) => {
    lines.push(`${i + 1}. ${job.title} — ${job.company}${job.isNew ? '  [new since last run]' : ''}`);
    lines.push(`   location: ${job.location || 'n/a'}${job.remote ? ' (remote ok)' : ''}`);
    lines.push(`   score: ${job.blended}/100  (fit ${job.fit} + freshness ${job.freshnessBonus})   ${ageLabel(job, now)}`);
    lines.push(`   why: ${job.rationale}`);
    lines.push(`   ${coverageLine(job)}`);
    lines.push(`   apply: ${job.url}`);
    if (job.deliverables?.dir) lines.push(`   tailored docs: ${job.deliverables.dir}`);
    if (job.deliverables?.missingKeywords?.length)
      lines.push(`   note — not covered (omitted, not faked): ${job.deliverables.missingKeywords.join(', ')}`);
    lines.push('');
  });
  lines.push(`— ${config.email.signature}`);
  return lines.join('\n');
}

function htmlDigest(matches, now) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = matches
    .map((job, i) => {
      const docs = job.deliverables?.dir ? `<div style="color:#555">tailored docs: ${esc(job.deliverables.dir)}</div>` : '';
      const missing = job.deliverables?.missingKeywords?.length
        ? `<div style="color:#a00">not covered (omitted, not faked): ${esc(job.deliverables.missingKeywords.join(', '))}</div>`
        : '';
      return `
      <tr><td style="padding:10px 0;border-bottom:1px solid #eee">
        <div style="font-size:15px"><strong>${i + 1}. ${esc(job.title)}</strong> — ${esc(job.company)} ${
          job.isNew ? '<span style="color:#0a7">[new since last run]</span>' : ''
        }</div>
        <div style="color:#555">${esc(job.location) || 'n/a'}${job.remote ? ' (remote ok)' : ''} · ${esc(ageLabel(job, now))}</div>
        <div><strong>${job.blended}/100</strong> <span style="color:#777">(fit ${job.fit} + freshness ${job.freshnessBonus})</span></div>
        <div>${esc(job.rationale)}</div>
        <div style="color:#555">${esc(coverageLine(job))}</div>
        <div><a href="${esc(job.url)}">apply link</a></div>
        ${docs}
        ${missing}
      </td></tr>`;
    })
    .join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
    <h2 style="margin-bottom:4px">Missy job digest — ${now.toISOString().slice(0, 10)}</h2>
    <p style="color:#555;margin-top:0">${matches.length} match${matches.length === 1 ? '' : 'es'} to review. Nothing has been applied to — this is for your manual review.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#777">— ${esc(config.email.signature)}</p>
  </div>`;
}

function sheetRows(matches, now) {
  const date = now.toISOString().slice(0, 10);
  return matches.map((job) => [
    date,
    job.company,
    job.title,
    job.location || '',
    String(job.blended),
    job.url || '',
    'new', // Dave updates this field manually: new/reviewing/applied/passed/interview
    job.rationale || '',
  ]);
}

async function maybeInstantAlert(matches, state, now, dryRun) {
  if (config.instantAlertMin === null || !has.email()) return;
  const hot = matches.filter((job) => {
    const age = ageDays(job, now);
    return job.blended >= config.instantAlertMin && age !== null && age < 1 && !hasSentInstant(state, job.id);
  });
  for (const job of hot) {
    const subject = `Fresh high-fit role: ${job.title} at ${job.company} (${job.blended}/100)`;
    const text = `Posted in the last 24h and scored ${job.blended}/100.\n\n${job.title} — ${job.company}\n${job.location || ''}\nwhy: ${job.rationale}\napply: ${job.url}\n\nReview only — nothing has been applied to.`;
    if (!dryRun) {
      try {
        await sendDigest({ subject, text, html: `<p>${text.replace(/\n/g, '<br>')}</p>` });
        markInstant(state, job.id, now.toISOString());
        log.info(`instant alert sent for ${job.company} — ${job.title}.`);
      } catch (e) {
        log.warn(`instant alert failed: ${e.message}`);
      }
    } else {
      log.info(`[dry-run] would send instant alert for ${job.company} — ${job.title}.`);
    }
  }
}

export async function runReporter(matches, { state, now = new Date(), dryRun = false } = {}) {
  const text = textDigest(matches, now);
  const html = htmlDigest(matches, now);
  const subject = `Missy job digest — ${matches.length} match${matches.length === 1 ? '' : 'es'} — ${now.toISOString().slice(0, 10)}`;

  // Always print the digest preview to the terminal.
  log.info('--- digest preview ---');
  console.log('\n' + text + '\n');
  log.info('--- end digest preview ---');

  // Instant alerts (optional, before the main digest).
  await maybeInstantAlert(matches, state, now, dryRun);

  if (dryRun) {
    log.info('[dry-run] no email sent, no sheet write, no state change.');
    return { emailed: false, sheetAppended: 0 };
  }

  if (!matches.length) {
    log.info('no matches today — nothing to email or log.');
    return { emailed: false, sheetAppended: 0 };
  }

  // Email the digest.
  let emailed = false;
  try {
    const res = await sendDigest({ subject, text, html });
    if (res.enabled) {
      emailed = true;
      log.info(`digest emailed to ${res.to}.`);
    } else {
      log.info('email not configured (Zoho SMTP) — printed to terminal only.');
    }
  } catch (e) {
    log.warn(`sending digest failed: ${e.message}`);
  }

  // Append to the Google Sheet tracker.
  let appended = 0;
  if (has.sheets()) {
    try {
      await ensureSheet();
      const res = await appendRows(sheetRows(matches, now));
      appended = res.appended || 0;
      log.info(`appended ${appended} row(s) to the tracker sheet.`);
    } catch (e) {
      log.warn(`sheet append failed: ${e.message}`);
    }
  } else {
    log.info('google sheet not configured — skipping tracker write.');
  }

  // Record delivered ids so nothing repeats in a later digest.
  recordDigest(state, matches.map((m) => m.id), now.toISOString());

  return { emailed, sheetAppended: appended };
}
