#!/usr/bin/env node
/**
 * GBP Audit — Google Business Profile gap analysis for outreach
 *
 * Reads lead files and generates a specific "profile gap" report per business.
 * The gap list becomes a concrete outreach hook:
 *   "I ran a quick check on your Google profile — found 3 things costing you jobs."
 *
 * Zero API cost — all analysis is local based on Scout data.
 *
 * Usage:
 *   node scripts/gbp-audit.js              # all leads
 *   node scripts/gbp-audit.js --trade plumber
 *   node scripts/gbp-audit.js --min-gaps 3  # only leads with ≥3 gaps
 *   node scripts/gbp-audit.js --top 20      # top 20 by gap count
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const LEADS_DIR  = path.join(ROOT, 'leads');
const QUEUE_DIR  = path.join(ROOT, 'queue');
const REPORT_DIR = path.join(ROOT, 'reports');

const args        = process.argv.slice(2);
const getArg      = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const tradeFilter = getArg('--trade');
const minGaps     = parseInt(getArg('--min-gaps') || '1', 10);
const topN        = parseInt(getArg('--top') || '0', 10);

// ── GAP CHECKERS ──────────────────────────────────────────────────────────────

function analyzeGaps(lead) {
  const gaps = [];

  if (!lead.website || lead.website === 'none' || lead.website === '') {
    gaps.push({
      id:     'no_website',
      label:  'No website',
      detail: 'Google ranks businesses with websites higher. Competitors are taking your search traffic.',
      impact: 'high',
    });
  }

  if (!lead.email || lead.email.trim() === '') {
    gaps.push({
      id:     'no_email',
      label:  'No contact email on profile',
      detail: 'Customers looking to email quotes hit a dead end.',
      impact: 'medium',
    });
  }

  if (!lead.address || lead.address.trim() === '') {
    gaps.push({
      id:     'no_address',
      label:  'No service area listed',
      detail: 'Google penalizes profiles without a verifiable address or service area.',
      impact: 'medium',
    });
  }

  const reviews = lead.review_count || 0;
  if (reviews < 15) {
    gaps.push({
      id:     'low_reviews',
      label:  `Only ${reviews} Google reviews`,
      detail: 'Customers scan review count before clicking. Under 15 reviews looks unestablished.',
      impact: 'high',
    });
  } else if (reviews < 30) {
    gaps.push({
      id:     'moderate_reviews',
      label:  `${reviews} reviews — below the 30-review trust threshold`,
      detail: '30+ reviews is where customer trust jumps significantly.',
      impact: 'medium',
    });
  }

  const rating = parseFloat(lead.rating) || 0;
  if (rating < 4.5 && rating > 0) {
    gaps.push({
      id:     'low_rating',
      label:  `${rating}★ rating — below the 4.5★ customer threshold`,
      detail: '62% of customers filter for 4.5★+. A few review responses can shift perception.',
      impact: 'high',
    });
  }

  if (!lead.phone || lead.phone.trim() === '') {
    gaps.push({
      id:     'no_phone',
      label:  'No phone number on profile',
      detail: 'Direct click-to-call is the #1 conversion action for mobile searches.',
      impact: 'high',
    });
  }

  return gaps;
}

// ── OUTREACH HOOK ─────────────────────────────────────────────────────────────

function buildHook(lead, gaps) {
  const count = gaps.length;
  const highImpact = gaps.filter(g => g.impact === 'high');

  if (count === 0) return 'Profile looks solid — outreach angle is competitive positioning.';

  if (highImpact.length >= 2) {
    const [g1, g2] = highImpact;
    return `Quick audit on ${lead.business_name}: ${g1.label.toLowerCase()} + ${g2.label.toLowerCase()}. "I found 2 things costing you calls — takes 15 min to fix both."`;
  }

  return `"I did a quick Google profile check on ${lead.business_name} and found ${count} gap${count > 1 ? 's' : ''} that are probably costing you leads. Happy to share what I found?"`;
}

// ── LOAD LEADS ────────────────────────────────────────────────────────────────

function loadAllLeads() {
  const files  = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));
  const byId   = {};

  for (const file of files) {
    try {
      const leads = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, file), 'utf8'));
      for (const lead of leads) {
        if (lead.lead_id) byId[lead.lead_id] = lead;
      }
    } catch { /* skip */ }
  }
  return Object.values(byId);
}

function getApprovedIds() {
  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  const ids   = new Set();
  for (const file of files) {
    try {
      const brief = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      if (brief.checker_approved) ids.add(brief.lead_id);
    } catch { /* skip */ }
  }
  return ids;
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
  const outPath = path.join(REPORT_DIR, `gbp-audit-${date}.csv`);

  const headers = ['rank','business_name','trade','city','phone','reviews','rating','gap_count','gaps','outreach_hook'];
  const lines   = rows.map(r => headers.map(h => escapeCsv(r[h])).join(','));
  fs.writeFileSync(outPath, [headers.join(','), ...lines].join('\n') + '\n');
  return outPath;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const approvedIds = getApprovedIds();
  let leads = loadAllLeads()
    .filter(l => approvedIds.has(l.lead_id))
    .filter(l => !tradeFilter || l.trade === tradeFilter);

  // Analyze
  const audited = leads.map(lead => {
    const gaps = analyzeGaps(lead);
    return { lead, gaps };
  });

  // Filter + sort
  let results = audited
    .filter(r => r.gaps.length >= minGaps)
    .sort((a, b) => {
      // Most gaps first, then by gap_score
      if (b.gaps.length !== a.gaps.length) return b.gaps.length - a.gaps.length;
      return (b.lead.gap_score || 0) - (a.lead.gap_score || 0);
    });

  if (topN > 0) results = results.slice(0, topN);

  console.log(`\nGoogle Business Profile Audit`);
  console.log(`${results.length} leads analyzed${tradeFilter ? ` · trade: ${tradeFilter}` : ''}`);

  // Gap distribution
  const dist = {};
  for (const r of results) dist[r.gaps.length] = (dist[r.gaps.length] || 0) + 1;
  console.log(`Gap distribution: ${Object.entries(dist).map(([k,v]) => `${k} gaps: ${v}`).join(' | ')}`);
  console.log('─'.repeat(70));

  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const { lead, gaps } = results[i];
    const hook = buildHook(lead, gaps);

    console.log(`\n${i + 1}. ${lead.business_name} (${lead.trade}, ${lead.city})`);
    console.log(`   ${lead.review_count} reviews · ${lead.rating}★ · gap score: ${lead.gap_score}`);
    console.log(`   Gaps (${gaps.length}):`);
    for (const g of gaps) {
      console.log(`     [${g.impact.toUpperCase()}] ${g.label}`);
    }
    console.log(`   Hook: "${hook}"`);

    rows.push({
      rank:          i + 1,
      business_name: lead.business_name,
      trade:         lead.trade,
      city:          lead.city,
      phone:         lead.phone || '',
      reviews:       lead.review_count,
      rating:        lead.rating,
      gap_count:     gaps.length,
      gaps:          gaps.map(g => g.label).join(' | '),
      outreach_hook: hook,
    });
  }

  const csvPath = writeCSV(rows);
  console.log('\n' + '─'.repeat(70));
  console.log(`CSV written: ${csvPath}`);

  // High-value summary
  const highImpact = results.filter(r => r.gaps.filter(g => g.impact === 'high').length >= 2);
  console.log(`\nLeads with 2+ HIGH-impact gaps: ${highImpact.length}`);
  console.log('These are your strongest cold call / text hooks — lead with the audit angle.\n');
}

main();
