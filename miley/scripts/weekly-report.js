#!/usr/bin/env node
/**
 * Miley Weekly Revenue Report — sends Dave a Monday morning email summarising
 * the past week's content performance and revenue signals for @techs4tatas.
 *
 * Usage:
 *   node miley/scripts/weekly-report.js              # print + email
 *   node miley/scripts/weekly-report.js --print      # print only (no email)
 *   node miley/scripts/weekly-report.js --week 2026-06-29  # specific week
 *
 * Reads:
 *   miley/output/content/content-{weekOf}.json  — posts generated for the week
 *   miley/output/clicks/latest.json             — UTM click data (optional)
 *   miley/output/product-weights.json           — product performance weights (optional)
 *   miley/templates/brand-voice.json            — top hashtags, what_works
 *   .env.local (root)                           — ZOHO_EMAIL, ZOHO_APP_PASSWORD, REPORT_TO_EMAIL
 *
 * Run context: Mac only (Zoho SMTP is blocked from container).
 * Add to Mac cron: every Monday at 8am
 *   0 8 * * 1 cd /path/to/Website-Master && node miley/scripts/weekly-report.js >> logs/miley-report.log 2>&1
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.local') });

const fs   = require('fs');
const path = require('path');

const MILEY_ROOT = path.join(__dirname, '..');
const ROOT       = path.join(__dirname, '..', '..');

const args      = process.argv.slice(2);
const PRINT_ONLY = args.includes('--print');

function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

// ── date helpers ──────────────────────────────────────────────────────────────

function mondayOf(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

function prevWeekMonday() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return mondayOf(d);
}

// ── find content file ─────────────────────────────────────────────────────────

function findContentFile(weekOf) {
  const exact = path.join(MILEY_ROOT, 'output', 'content', `content-${weekOf}.json`);
  if (fs.existsSync(exact)) return exact;

  // fall back: most recent content file
  const dir = path.join(MILEY_ROOT, 'output', 'content');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('content-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}

// ── click data ────────────────────────────────────────────────────────────────

function loadClicks() {
  const p = path.join(MILEY_ROOT, 'output', 'clicks', 'latest.json');
  return readJson(p);
}

function loadProductWeights() {
  const p = path.join(MILEY_ROOT, 'output', 'product-weights.json');
  return readJson(p);
}

function loadBrandVoice() {
  const p = path.join(MILEY_ROOT, 'templates', 'brand-voice.json');
  return readJson(p);
}

// ── report builders ───────────────────────────────────────────────────────────

function postSummaryLines(posts) {
  const lines = [];
  for (const p of posts) {
    const day  = p.slot || p.day || '?';
    const type = p.contentType || p.format || 'post';
    const prod = p.product ? ` [${p.product}]` : '';
    const src  = p.source === 'evergreen' ? ' (evergreen)' : '';
    const hook = p.hook ? p.hook.slice(0, 60) + (p.hook.length > 60 ? '…' : '') : '—';
    lines.push(`  ${day.padEnd(4)} ${type.padEnd(25)}${prod}${src}`);
    lines.push(`       Hook: ${hook}`);
  }
  return lines;
}

function clickSection(clicks) {
  if (!clicks) return ['  No click data yet. Drop a GA4/Pixel/ManyChat export at', '  miley/output/clicks/latest.json to see revenue attribution.'];
  const lines = [];
  const views = clicks.linkpage_views || 0;
  lines.push(`  Linkpage views:  ${views}`);
  const by = clicks.by_content || {};
  const sorted = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (sorted.length) {
    lines.push('  Clicks by product:');
    for (const [prod, cnt] of sorted) {
      lines.push(`    ${String(cnt).padStart(4)}  ${prod}`);
    }
  } else {
    lines.push('  No product click data yet.');
  }
  return lines;
}

function productWeightSection(weights) {
  if (!weights || !weights.weights) return null;
  const lines = ['  Product weights (revenue signal — higher = more airtime next cycle):'];
  const sorted = Object.entries(weights.weights).sort((a, b) => b[1] - a[1]);
  for (const [prod, w] of sorted.slice(0, 8)) {
    const bar = '█'.repeat(Math.round(w * 20)).padEnd(20);
    lines.push(`    ${bar}  ${(w * 100).toFixed(0).padStart(3)}%  ${prod}`);
  }
  if (weights.updatedAt) lines.push(`  (last updated: ${weights.updatedAt.split('T')[0]})`);
  return lines;
}

function whatWorksSection(brandVoice) {
  if (!brandVoice) return null;
  const ww = brandVoice.what_works;
  if (!ww || (!ww.formats?.length && !ww.top_hashtags?.length)) return null;
  const lines = ['  What\'s working (from Analyst):'];
  if (ww.formats?.length)    lines.push(`    Formats:    ${ww.formats.slice(0, 4).join(', ')}`);
  if (ww.tones?.length)      lines.push(`    Tones:      ${ww.tones.slice(0, 4).join(', ')}`);
  if (ww.top_hashtags?.length) lines.push(`    Top tags:   ${brandVoice.top_hashtags?.slice(0, 5).join(' ') || ww.top_hashtags.slice(0, 5).join(' ')}`);
  return lines;
}

function buildReport(weekOf, content, clicks, weights, brandVoice) {
  const posts    = content?.posts || [];
  const mode     = content?.campaignMode || 'base';
  const genAt    = content?.generatedAt ? content.generatedAt.split('T')[0] : '?';
  const postCount = posts.length;
  const evCount  = posts.filter(p => p.source === 'evergreen').length;
  const aiCount  = postCount - evCount;

  const L = [];
  L.push('════════════════════════════════════════════════════════');
  L.push(`  Miley (@techs4tatas) — Weekly Report`);
  L.push(`  Week of ${weekOf}   |   ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}`);
  L.push('════════════════════════════════════════════════════════');
  L.push('');

  // ── content this week ──
  L.push('CONTENT THIS WEEK');
  L.push(`  Campaign mode:  ${mode}`);
  L.push(`  Posts queued:   ${postCount}  (${aiCount} AI-generated, ${evCount} evergreen)`);
  L.push(`  Generated on:   ${genAt}`);
  L.push('');
  if (posts.length) {
    L.push('  Schedule:');
    L.push(...postSummaryLines(posts));
    L.push('');
  }

  // ── clicks / revenue ──
  L.push('CLICK ATTRIBUTION (past 7 days)');
  L.push(...clickSection(clicks));
  L.push('');

  // ── product weights ──
  const wlines = productWeightSection(weights);
  if (wlines) {
    L.push('PRODUCT ROTATION WEIGHTS');
    L.push(...wlines);
    L.push('');
  }

  // ── what's working ──
  const wwlines = whatWorksSection(brandVoice);
  if (wwlines) {
    L.push('PERFORMANCE SIGNALS');
    L.push(...wwlines);
    L.push('');
  }

  // ── next steps ──
  L.push('NEXT STEPS');
  L.push('  □ Review queue: open miley/output/queue/preview-*.html');
  L.push('  □ Approve & schedule: node miley/scripts/push-queue.js');
  if (!clicks) {
    L.push('  □ Drop GA4/Pixel export → miley/output/clicks/latest.json for revenue tracking');
  }
  L.push('  □ Thursday: pipeline auto-runs for next week (GitHub Actions)');
  L.push('');
  L.push('════════════════════════════════════════════════════════');

  return L.join('\n');
}

// ── email send ────────────────────────────────────────────────────────────────

async function sendEmail(body, weekOf) {
  const nodemailer = require('nodemailer');
  const user = process.env.ZOHO_EMAIL;
  const pass = process.env.ZOHO_APP_PASSWORD;
  const to   = process.env.REPORT_TO_EMAIL || process.env.ZOHO_EMAIL;

  if (!user || !pass) throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local');
  if (!to)            throw new Error('REPORT_TO_EMAIL (or ZOHO_EMAIL) must be set in .env.local');

  const transport = nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user, pass },
  });

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject   = `Techs4Tatas Weekly Report — ${dateLabel}`;

  await transport.sendMail({
    from:    `Trevo Advisors <${user}>`,
    to,
    subject,
    text:    body,
  });

  return { subject, to };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const weekArg  = argVal('--week');
  const weekOf   = weekArg || prevWeekMonday();

  const contentFile = findContentFile(weekOf);
  const content     = contentFile ? readJson(contentFile) : null;
  const actualWeek  = content?.weekOf || weekOf;

  const clicks      = loadClicks();
  const weights     = loadProductWeights();
  const brandVoice  = loadBrandVoice();

  if (!content) {
    console.warn(`⚠  No content file found for week ${weekOf}. Generating report with available data only.`);
  }

  const report = buildReport(actualWeek, content, clicks, weights, brandVoice);
  console.log(report);

  if (!PRINT_ONLY) {
    try {
      const { subject, to } = await sendEmail(report, actualWeek);
      console.log(`\n✓ Report emailed to ${to}`);
      console.log(`  Subject: ${subject}`);
    } catch (err) {
      console.error(`\n✗ Email failed: ${err.message}`);
      console.error('  Report printed above — copy/paste manually if needed.');
      process.exit(1);
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
