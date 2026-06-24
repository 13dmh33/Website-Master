#!/usr/bin/env node
/**
 * Caller — cold call sheet generator
 *
 * Turns checker-approved queue briefs into a ranked call list.
 * Outputs a formatted table to the terminal + a CSV to reports/.
 *
 * Usage:
 *   node scripts/caller.js               # all approved, sorted by priority
 *   node scripts/caller.js --trade plumber
 *   node scripts/caller.js --limit 20
 *   node scripts/caller.js --no-csv      # terminal only
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const QUEUE_DIR  = path.join(ROOT, 'queue');
const REPORT_DIR = path.join(ROOT, 'reports');

const args     = process.argv.slice(2);
const getArg   = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const tradeFilter = getArg('--trade');
const limitArg    = parseInt(getArg('--limit') || '0', 10);
const noCsv       = args.includes('--no-csv');
const smsMode     = args.includes('--sms');  // show copy-paste SMS texts instead of call talk tracks

// ── LOAD BRIEFS ───────────────────────────────────────────────────────────────

function loadBriefs() {
  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  const briefs = [];

  for (const file of files) {
    try {
      const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      if (!brief.checker_approved) continue;
      if (!brief.phone)            continue;
      briefs.push(brief);
    } catch { /* skip malformed */ }
  }
  return briefs;
}

// ── RANK ──────────────────────────────────────────────────────────────────────

function rankBriefs(briefs) {
  return briefs
    .filter(b => !tradeFilter || b.trade === tradeFilter)
    .sort((a, b) => {
      // priority flag first
      if (b.priority !== a.priority) return b.priority ? 1 : -1;
      // then gap_score desc
      if (b.gap_score !== a.gap_score) return (b.gap_score || 0) - (a.gap_score || 0);
      // then rating desc
      return (b.rating || 0) - (a.rating || 0);
    });
}

// ── TALK TRACK ────────────────────────────────────────────────────────────────

function talkTrack(brief) {
  // Two-sentence opener + one hook question for the call
  const website = brief.website === 'none' || !brief.website ? 'no website' : brief.website;
  const hook    = brief.hero_angle || brief.diagnosis || '';
  const opener  = `${brief.business_name} has ${brief.review_count} reviews and ${website}. ${hook.split('.')[0]}.`;
  return opener.replace(/\s+/g, ' ').trim();
}

// ── SMS MODE ──────────────────────────────────────────────────────────────────

function printSMS(ranked) {
  console.log('\nSend from your personal iPhone — no A2P/Twilio needed.');
  console.log('─'.repeat(60));
  for (let i = 0; i < ranked.length; i++) {
    const b = ranked[i];
    const msg  = b.final_message || b.cold_message || '';
    const demo = b.demo_url || '';
    console.log(`\n${i + 1}. ${b.business_name} · ${b.phone}`);
    console.log(`   ${msg}`);
    if (demo) console.log(`   Demo: ${demo}`);
  }
  console.log('\n' + '─'.repeat(60));
  console.log('Tips:');
  console.log('  • Text from your personal number — no A2P registration needed');
  console.log('  • Best windows: 9–11am or 1–3pm weekdays');
  console.log('  • Add demo URL as a follow-up text if they reply with interest');
  console.log('  • If they call back: "I sent you a text — I build websites for [trade]s in [city]"');
  console.log('  • Do 10–15/day max to stay personal and avoid spam flags');
  console.log();
}

// ── TABLE OUTPUT ──────────────────────────────────────────────────────────────

const COLS = [
  { key: '#',       w: 4  },
  { key: 'Business',w: 30 },
  { key: 'Trade',   w: 12 },
  { key: 'City',    w: 20 },
  { key: 'Phone',   w: 16 },
  { key: 'Reviews', w: 8  },
  { key: 'Rating',  w: 7  },
  { key: 'Gap',     w: 4  },
];

function pad(str, w) { return String(str).padEnd(w).slice(0, w); }

function printTable(ranked) {
  const header = COLS.map(c => pad(c.key, c.w)).join(' ');
  const rule   = COLS.map(c => '─'.repeat(c.w)).join(' ');

  console.log('\n' + rule);
  console.log(header);
  console.log(rule);

  for (let i = 0; i < ranked.length; i++) {
    const b = ranked[i];
    const row = [
      pad(i + 1, COLS[0].w),
      pad(b.business_name, COLS[1].w),
      pad(b.trade, COLS[2].w),
      pad(b.city, COLS[3].w),
      pad(b.phone, COLS[4].w),
      pad(b.review_count, COLS[5].w),
      pad(b.rating, COLS[6].w),
      pad(b.gap_score || '?', COLS[7].w),
    ].join(' ');
    console.log(row);
    // Indented hook on next line
    console.log(`     ${talkTrack(b).slice(0, 100)}`);
    console.log();
  }

  console.log(rule);
}

// ── CSV OUTPUT ────────────────────────────────────────────────────────────────

function escapeCsv(val) {
  const s = String(val == null ? '' : val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function writeCSV(ranked) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const date     = new Date().toISOString().split('T')[0];
  const outPath  = path.join(REPORT_DIR, `call-sheet-${date}.csv`);

  const headers = ['rank','business_name','trade','city','phone','review_count','rating','gap_score','channel','talk_track','final_message'];

  const rows = ranked.map((b, i) => [
    i + 1,
    b.business_name,
    b.trade,
    b.city,
    b.phone,
    b.review_count,
    b.rating,
    b.gap_score || '',
    b.channel,
    talkTrack(b),
    b.final_message || b.cold_message || ''
  ].map(escapeCsv).join(','));

  fs.writeFileSync(outPath, [headers.join(','), ...rows].join('\n') + '\n');
  return outPath;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const briefs = loadBriefs();
  let   ranked = rankBriefs(briefs);
  const total  = ranked.length;

  if (limitArg > 0) ranked = ranked.slice(0, limitArg);

  const modeLabel = smsMode ? 'Personal SMS Texts' : 'Cold Call Sheet';
  console.log(`\n${modeLabel} — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`);
  console.log(`${ranked.length} leads${limitArg > 0 ? ` (of ${total})` : ''} · sorted by gap score`);
  if (tradeFilter) console.log(`Trade filter: ${tradeFilter}`);

  if (ranked.length === 0) {
    console.log('No approved leads with phone numbers found.');
    return;
  }

  if (smsMode) {
    printSMS(ranked);
    return;
  }

  printTable(ranked);

  if (!noCsv) {
    const csvPath = writeCSV(ranked);
    console.log(`CSV written: ${csvPath}`);
  }

  // Call tips
  console.log('\nCall tips:');
  console.log('  • Best time: Tue–Thu 10am–12pm or 2–4pm local time');
  console.log('  • Opener: "Hey, is this [name]? I\'m Dave — I build websites for [trade]s in [city]. Quick question — do you have a site?"');
  console.log('  • If no: "I can have one live this week for $100 flat. Worth a 15-minute call?"');
  console.log('  • If yes: "Got it — we also do AI chatbots that follow up on quote requests 24/7. Five minutes to show you?"');
  console.log('  • Close: "I\'ll send you a link to see what it looks like before you decide anything."');
  console.log();

  // Trade breakdown
  const byTrade = {};
  for (const b of ranked) byTrade[b.trade] = (byTrade[b.trade] || 0) + 1;
  console.log('By trade:', Object.entries(byTrade).map(([k, v]) => `${k}: ${v}`).join(' · '));
  console.log();
}

main();
