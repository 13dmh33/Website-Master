#!/usr/bin/env node
/**
 * LinkedIn — connection request + follow-up generator for queue leads
 *
 * Generates personalized LinkedIn outreach for every approved brief.
 * Zero API cost — all logic is local.
 *
 * Usage:
 *   node scripts/linkedin.js              # all approved leads
 *   node scripts/linkedin.js --trade plumber
 *   node scripts/linkedin.js --limit 20
 *
 * Output:
 *   reports/linkedin-{date}.csv           (rank, biz, search URL, connect note, follow-up DM)
 *   Terminal preview of top 5
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const QUEUE_DIR  = path.join(ROOT, 'queue');
const REPORT_DIR = path.join(ROOT, 'reports');

const args        = process.argv.slice(2);
const getArg      = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const tradeFilter = getArg('--trade');
const limitArg    = parseInt(getArg('--limit') || '0', 10);

// ── TRADE LABELS ──────────────────────────────────────────────────────────────

const TRADE_LABELS = {
  plumber:     'plumber',
  hvac:        'HVAC contractor',
  electrician: 'electrician',
  roofer:      'roofer',
  handyman:    'handyman',
};

// ── CONNECT MESSAGES (≤300 chars, LinkedIn limit) ────────────────────────────

// Variant pool — we rotate to avoid pattern detection
const CONNECT_VARIANTS = [
  (b) => `Hi — I saw ${b.business_name} on Google Maps. ${b.review_count} reviews and no website is a gap I help fix. I build sites for ${TRADE_LABELS[b.trade] || b.trade}s — $150 flat. Worth connecting? — Dave`,
  (b) => `Hey — noticed ${b.business_name} has great Google reviews but no site. I build contractor websites that convert that traffic into calls. $150, live in a week. Happy to connect — Dave @ Trevo`,
  (b) => `Hi — I help ${TRADE_LABELS[b.trade] || b.trade}s in ${cityShort(b.city)} turn their Google reputation into real leads with a simple $150 website. Saw ${b.business_name} and thought it'd be a fit. — Dave`,
];

// ── FOLLOW-UP DM (sent 3–5 days after connection) ────────────────────────────

const FOLLOWUP_VARIANTS = [
  (b) => `Hey — thanks for connecting. Quick context: I saw ${b.business_name} has ${b.review_count} Google reviews (great!) but no website. Right now those reviews aren't turning into calls the way they could.\n\nI built sites for ${TRADE_LABELS[b.trade] || b.trade}s in similar spots — $150 flat, I handle everything, live in 3 days. Would it be worth a 15-min call this week? I can show you what it looks like before you decide anything.\n\n— Dave @ Trevo Advisors\ntrevoadvisors.com`,
  (b) => `Hi — just following up from my connection request. I specialize in websites for home service contractors — specifically ones like ${b.business_name} that have strong Google reviews but aren't capturing that traffic yet.\n\nI keep it simple: $150 flat, custom to your trade, live within a week. I can send a demo first so you see it before committing.\n\nWorth a quick chat? — Dave`,
];

function cityShort(city) { return (city || '').split(',')[0].trim(); }

function pickVariant(variants, brief, seed) {
  return variants[seed % variants.length](brief);
}

// ── LINKEDIN SEARCH URL ───────────────────────────────────────────────────────

function linkedinSearchUrl(brief) {
  const q = encodeURIComponent(`"${brief.business_name}" ${cityShort(brief.city)}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}`;
}

// ── LOAD AND RANK ─────────────────────────────────────────────────────────────

function loadBriefs() {
  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  const briefs = [];
  for (const file of files) {
    try {
      const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      if (!brief.checker_approved) continue;
      briefs.push(brief);
    } catch { /* skip */ }
  }
  return briefs
    .filter(b => !tradeFilter || b.trade === tradeFilter)
    .sort((a, b) => ((b.gap_score || 0) - (a.gap_score || 0)) || ((b.rating || 0) - (a.rating || 0)));
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function escapeCsv(val) {
  const s = String(val == null ? '' : val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCSV(rows) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date    = new Date().toISOString().split('T')[0];
  const outPath = path.join(REPORT_DIR, `linkedin-${date}.csv`);

  const headers = ['rank','business_name','trade','city','phone','reviews','rating','gap_score','linkedin_search_url','connect_note','followup_dm'];
  const lines   = rows.map(r => headers.map(h => escapeCsv(r[h])).join(','));
  fs.writeFileSync(outPath, [headers.join(','), ...lines].join('\n') + '\n');
  return outPath;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  let briefs = loadBriefs();
  const total = briefs.length;
  if (limitArg > 0) briefs = briefs.slice(0, limitArg);

  console.log(`\nLinkedIn Outreach — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`);
  console.log(`${briefs.length} leads${limitArg > 0 ? ` (of ${total})` : ''}${tradeFilter ? ` · trade: ${tradeFilter}` : ''}`);

  if (briefs.length === 0) {
    console.log('No approved leads found.');
    return;
  }

  const rows = briefs.map((b, i) => ({
    rank:                i + 1,
    business_name:       b.business_name,
    trade:               b.trade,
    city:                b.city,
    phone:               b.phone || '',
    reviews:             b.review_count,
    rating:              b.rating,
    gap_score:           b.gap_score || '',
    linkedin_search_url: linkedinSearchUrl(b),
    connect_note:        pickVariant(CONNECT_VARIANTS, b, i),
    followup_dm:         pickVariant(FOLLOWUP_VARIANTS, b, i),
  }));

  const csvPath = writeCSV(rows);
  console.log(`CSV written: ${csvPath}\n`);

  // Preview top 5
  console.log('Top 5 preview:');
  console.log('─'.repeat(70));
  for (const r of rows.slice(0, 5)) {
    console.log(`${r.rank}. ${r.business_name} (${r.trade}, ${r.city}) · ${r.reviews} reviews · gap ${r.gap_score}`);
    console.log(`   Search: ${r.linkedin_search_url}`);
    console.log(`   Connect: "${r.connect_note}"`);
    console.log();
  }

  // Tips
  console.log('LinkedIn outreach tips:');
  console.log('  • Send 15–20 connection requests per day to stay under LinkedIn limits');
  console.log('  • Use the connect_note column verbatim — it\'s ≤300 chars (LinkedIn limit)');
  console.log('  • Wait 3–5 days after connection, then send the followup_dm');
  console.log('  • Best day to connect: Tuesday morning (highest acceptance rate)');
  console.log('  • If they view your profile after connecting — send the DM same day');
  console.log('  • Search tip: look for owner/founder title, not employee');
  console.log();
}

main();
