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

// Apply-URL line — three cases per CHANGE_REQUEST.md Change 1. Plain text only
// (never wrapped in an <a> in the text digest, and never auto-linkified) so it
// survives copy-paste intact even from a plain-text email client.
function applyLines(job) {
  if (!job.url) return ['apply: NOT CAPTURED'];
  if (job.applyUrl) {
    return [`apply (via listing page): ${job.url}`, `apply (direct link): ${job.applyUrl}`];
  }
  return [`apply: ${job.url}`];
}

// Score breakdown (Change 3) — three terms now that location is scored
// alongside fit + freshness, plus the location evidence line (Change 2).
function scoreLine(job) {
  return `score: ${job.blended}/100  (fit ${job.fit} + freshness ${job.freshnessBonus} + location ${job.locationDelta >= 0 ? '+' : ''}${job.locationDelta})`;
}

// Career-coach review lines — only present for the top 1-3 jobs career-coach.js
// picked. Nothing here has been written to a .docx; approve/reject commands
// are how Dave actually generates one. The highlighted resume diff is embedded
// in full, not just linked — the whole point of putting this in the digest
// (Dave's choice) was reviewing it without having to go open a local file.
function careerCoachLines(job) {
  const cc = job.careerCoach;
  if (!cc) return [];
  const lines = [
    '',
    `--- career-coach review: ${cc.fitPercent}% fit (${cc.archetype}) — ${cc.verdict} ---`,
    cc.hasBaseline
      ? '(added text shown as **bold**, removed text as ~~strikethrough~~, vs. last approved resume for this archetype)'
      : '(no prior approved resume for this archetype yet — full draft shown as new)',
    '',
    cc.diffMarkdown,
    '',
  ];
  if (cc.gaps.length) {
    lines.push('gaps (role asks for this, current brief shows no evidence of it):');
    for (const g of cc.gaps) lines.push(`  - ${g.requirement} — ${g.note}`);
  }
  if (cc.openItemsFlagged.length) {
    lines.push('OPEN ITEMS FLAGGED — resolve before approving:');
    for (const o of cc.openItemsFlagged) lines.push(`  - ${o.item} — ${o.note}`);
  }
  if (!cc.reviewPath) lines.push('(dry-run — no draft was persisted; the commands below will not work until a real run)');
  lines.push(`approve: ${cc.approveCommand}`);
  lines.push(`reject:  ${cc.rejectCommand}`);
  return lines;
}

// Minimal Markdown -> HTML for the diff only: bold (added) / strikethrough
// (removed) spans and paragraph breaks. Not the general-purpose renderer in
// lib/docx.js — this only ever sees diffToMarkdown()'s output (**/~~ spans and
// plain text), so it stays deliberately small.
function diffMarkdownToHtml(md, esc) {
  return String(md || '')
    .split('\n')
    .map((line) => {
      const withSpans = esc(line)
        .replace(/\*\*(.+?)\*\*/g, '<strong style="background:#d7f5ee">$1</strong>')
        .replace(/~~(.+?)~~/g, '<s style="color:#a00">$1</s>');
      return withSpans;
    })
    .join('<br>');
}

function textDigest(matches, now, duplicateFitWarning) {
  const lines = [];
  lines.push(`Missy job digest — ${now.toISOString().slice(0, 10)}`);
  lines.push(`${matches.length} match${matches.length === 1 ? '' : 'es'} to review. Nothing has been applied to — this is for your manual review.`);
  if (duplicateFitWarning) lines.push(`NOTE: ${duplicateFitWarning}`);
  lines.push('');
  matches.forEach((job, i) => {
    lines.push(`${i + 1}. ${job.title} — ${job.company}${job.isNew ? '  [new since last run]' : ''}`);
    lines.push(`   location: ${job.location || 'n/a'}${job.remote ? ' (remote ok)' : ''}`);
    lines.push(`   ${scoreLine(job)}   ${ageLabel(job, now)}`);
    if (job.locationEvidence) lines.push(`   ${job.locationEvidence}${job.isMulti ? ' [multi-location posting]' : ''}`);
    lines.push(`   why: ${job.rationale}`);
    lines.push(`   ${coverageLine(job)}`);
    for (const l of applyLines(job)) lines.push(`   ${l}`);
    if (job.deliverables?.dir) lines.push(`   tailored docs: ${job.deliverables.dir}`);
    if (job.deliverables?.missingKeywords?.length)
      lines.push(`   note — not covered (omitted, not faked): ${job.deliverables.missingKeywords.join(', ')}`);
    for (const l of careerCoachLines(job)) lines.push(`   ${l}`);
    lines.push('');
  });
  lines.push(`— ${config.email.signature}`);
  return lines.join('\n');
}

// Apply-URL block for the HTML digest — mirrors applyLines()'s three cases,
// but as real <a> links (the plain-text version keeps raw URLs, per Change 1's
// "never auto-linkified" requirement for that format specifically).
function applyHtml(job, esc) {
  if (!job.url) return '<div style="color:#a00">apply: NOT CAPTURED</div>';
  if (job.applyUrl) {
    return `<div><a href="${esc(job.url)}">apply (via listing page)</a> · <a href="${esc(job.applyUrl)}">apply (direct link)</a></div>`;
  }
  return `<div><a href="${esc(job.url)}">apply link</a></div>`;
}

function htmlDigest(matches, now, duplicateFitWarning) {
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = matches
    .map((job, i) => {
      const docs = job.deliverables?.dir ? `<div style="color:#555">tailored docs: ${esc(job.deliverables.dir)}</div>` : '';
      const missing = job.deliverables?.missingKeywords?.length
        ? `<div style="color:#a00">not covered (omitted, not faked): ${esc(job.deliverables.missingKeywords.join(', '))}</div>`
        : '';
      const cc = job.careerCoach;
      const coach = cc
        ? `<div style="margin-top:8px;padding:8px;background:#f6f6f6;border-left:3px solid #444">
            <div><strong>career-coach: ${cc.fitPercent}% fit (${esc(cc.archetype)})</strong> — ${esc(cc.verdict)}</div>
            ${cc.gaps.length ? `<div style="color:#555">gaps: ${esc(cc.gaps.map((g) => g.requirement).join('; '))}</div>` : ''}
            ${
              cc.openItemsFlagged.length
                ? `<div style="color:#a00">OPEN ITEMS FLAGGED — resolve before approving: ${esc(cc.openItemsFlagged.map((o) => o.item).join('; '))}</div>`
                : ''
            }
            <div style="color:#555;font-size:12px">${cc.hasBaseline ? 'added shown highlighted, removed shown struck through — vs. last approved resume for this archetype' : 'no prior approved resume for this archetype yet — full draft shown as new'}</div>
            <div style="margin-top:6px;padding:8px;background:#fff;border:1px solid #ddd;font-size:13px;line-height:1.5">${diffMarkdownToHtml(cc.diffMarkdown, esc)}</div>
            ${!cc.reviewPath ? '<div style="color:#a00;font-size:12px">(dry-run — no draft was persisted; the commands below will not work until a real run)</div>' : ''}
            <div style="font-family:monospace;font-size:12px;margin-top:6px">${esc(cc.approveCommand)}<br>${esc(cc.rejectCommand)}</div>
          </div>`
        : '';
      return `
      <tr><td style="padding:10px 0;border-bottom:1px solid #eee">
        <div style="font-size:15px"><strong>${i + 1}. ${esc(job.title)}</strong> — ${esc(job.company)} ${
          job.isNew ? '<span style="color:#0a7">[new since last run]</span>' : ''
        }</div>
        <div style="color:#555">${esc(job.location) || 'n/a'}${job.remote ? ' (remote ok)' : ''} · ${esc(ageLabel(job, now))}</div>
        <div><strong>${job.blended}/100</strong> <span style="color:#777">(fit ${job.fit} + freshness ${job.freshnessBonus} + location ${job.locationDelta >= 0 ? '+' : ''}${job.locationDelta})</span></div>
        ${job.locationEvidence ? `<div style="color:#555;font-size:12px">${esc(job.locationEvidence)}${job.isMulti ? ' [multi-location posting]' : ''}</div>` : ''}
        <div>${esc(job.rationale)}</div>
        <div style="color:#555">${esc(coverageLine(job))}</div>
        ${applyHtml(job, esc)}
        ${docs}
        ${missing}
        ${coach}
      </td></tr>`;
    })
    .join('');
  const warningHtml = duplicateFitWarning
    ? `<p style="color:#a00;background:#fff3e0;padding:8px;border-radius:4px">${esc(duplicateFitWarning)}</p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
    <h2 style="margin-bottom:4px">Missy job digest — ${now.toISOString().slice(0, 10)}</h2>
    <p style="color:#555;margin-top:0">${matches.length} match${matches.length === 1 ? '' : 'es'} to review. Nothing has been applied to — this is for your manual review.</p>
    ${warningHtml}
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

export async function runReporter(matches, { state, now = new Date(), dryRun = false, duplicateFitWarning = null } = {}) {
  const text = textDigest(matches, now, duplicateFitWarning);
  const html = htmlDigest(matches, now, duplicateFitWarning);
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
