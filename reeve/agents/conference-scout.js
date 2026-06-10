'use strict';

// conference-scout.js — weekly CFP discovery agent
//
// Runs Monday 7am MT (after researcher.js in the Milly pipeline completes)
// Searches for open calls for speakers via SerpApi
// Saves new opportunities to output/opportunities/{id}.json
// Skips duplicates (same URL already in the pipeline)
//
// Sources searched:
//   - papercall.io (community tech/startup conferences)
//   - sessionize.com (tech conferences)
//   - direct Google search for conference speaker applications
//   - speaking.io, conferencemonster.com via Google
//
// Usage:
//   node agents/conference-scout.js
//   node agents/conference-scout.js --dry-run   (log, don't save)
//   node agents/conference-scout.js --summary   (print pipeline summary only)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fetch    = require('node-fetch');
const oppStore = require('../lib/opportunity-store');

const isDryRun = process.argv.includes('--dry-run');
const isSummary = process.argv.includes('--summary');

// ── SerpApi ───────────────────────────────────────────────────────────────────

async function searchSerpApi(query) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      q:       query,
      engine:  'google',
      api_key: key,
      num:     '10',
    });
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { timeout: 10000 });
    if (!res.ok) return [];
    const data = await res.json();
    return data.organic_results || [];
  } catch {
    return [];
  }
}

// ── CFP Extraction ────────────────────────────────────────────────────────────

// Parse a search result and extract what we know about the conference
function extractOpportunity(result) {
  const text = `${result.title || ''} ${result.snippet || ''}`;
  const url  = result.link || null;

  // Skip non-CFP results
  const isCfp = /call for speakers|submit.*proposal|cfp open|speaker.*application|sessionize|papercall/i.test(text);
  if (!isCfp) return null;

  // Try to extract a deadline date (rough heuristic)
  const deadlineMatch = text.match(/deadline[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const rawDeadline   = deadlineMatch ? deadlineMatch[1] : null;
  let cfpDeadline     = null;
  if (rawDeadline) {
    const parsed = new Date(rawDeadline);
    if (!isNaN(parsed)) cfpDeadline = parsed.toISOString().split('T')[0];
  }

  // Extract topics from snippet keywords
  const topicKeywords = ['technology', 'leadership', 'business', 'startup', 'diversity', 'AI', 'health',
    'education', 'marketing', 'finance', 'innovation', 'entrepreneurship', 'women', 'sustainability'];
  const topics = topicKeywords.filter(kw => new RegExp(kw, 'i').test(text));

  // Infer fee type
  const feePaid  = /\$[\d,]+|paid|honorarium|stipend/i.test(text);
  const feeUnpaid = /volunteer|unpaid|no.*fee|no.*honorari/i.test(text);
  const fee = feePaid ? 'paid' : feeUnpaid ? 'unpaid' : 'unknown';

  const virtual = /virtual|online|remote/i.test(text);

  return {
    conference: (result.title || '').slice(0, 120),
    url,
    cfpDeadline,
    topics:     topics.slice(0, 5),
    fee,
    virtual,
    source:     url,
    notes:      (result.snippet || '').slice(0, 200),
  };
}

// ── Search queries ────────────────────────────────────────────────────────────

function buildQueries() {
  const now   = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year  = now.getFullYear();

  return [
    `site:papercall.io "call for speakers" open ${year}`,
    `site:sessionize.com "call for speakers" ${year}`,
    `"call for speakers" conference ${month} ${year} deadline`,
    `speaking opportunity submit proposal conference ${year}`,
    `keynote speaker application conference open ${year}`,
  ];
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary() {
  const all    = oppStore.getAllOpportunities();
  const open   = oppStore.getOpenOpportunities();
  const today  = new Date().toISOString().split('T')[0];
  const urgent = open.filter(o => o.cfpDeadline && o.cfpDeadline <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);

  console.log('\n═══ Reeve Conference Pipeline ═══');
  console.log(`Total indexed:  ${all.length}`);
  console.log(`Open (active):  ${open.length}`);
  console.log(`Deadline <7d:   ${urgent.length}`);
  console.log('');

  if (urgent.length > 0) {
    console.log('⚠️  Urgent — deadline within 7 days:');
    for (const o of urgent) {
      console.log(`  • ${o.conference} — deadline ${o.cfpDeadline}`);
      if (o.url) console.log(`    ${o.url}`);
    }
    console.log('');
  }

  if (open.length > 0) {
    console.log('Open opportunities:');
    for (const o of open) {
      const deadline = o.cfpDeadline || 'no deadline listed';
      const pitched  = o.pitches?.length ? `  [${o.pitches.length} pitch(es) sent]` : '';
      console.log(`  • ${o.conference} — ${deadline}${pitched}`);
    }
  } else {
    console.log('No open opportunities. Run without --summary to scout for new ones.');
  }

  console.log('═'.repeat(35));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isSummary) {
    printSummary();
    return;
  }

  console.log(`\nConference Scout starting${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  if (!process.env.SERPAPI_KEY) {
    console.log('SERPAPI_KEY not configured — scout cannot run without live search.');
    console.log('Add SERPAPI_KEY to .env and retry.');
    process.exit(1);
  }

  const queries   = buildQueries();
  let found = 0, saved = 0, skipped = 0;

  for (const query of queries) {
    console.log(`\nSearching: ${query}`);
    const results = await searchSerpApi(query);

    for (const result of results) {
      found++;
      const opp = extractOpportunity(result);
      if (!opp) { skipped++; continue; }

      // Skip duplicates — same URL already in pipeline
      if (opp.url && oppStore.isDuplicate(opp.url)) {
        console.log(`  dup: ${opp.conference.slice(0, 60)}`);
        skipped++;
        continue;
      }

      console.log(`  new: ${opp.conference.slice(0, 70)}`);
      if (opp.cfpDeadline) console.log(`       deadline: ${opp.cfpDeadline}`);

      if (!isDryRun) {
        oppStore.createOpportunity(opp);
        saved++;
      } else {
        saved++; // count in dry run for reporting
      }
    }
  }

  const open = oppStore.getOpenOpportunities();

  console.log('\n' + '─'.repeat(50));
  console.log(`Scout complete.`);
  console.log(`  Results scanned:  ${found}`);
  console.log(`  New opportunities: ${isDryRun ? `${saved} (dry run)` : saved}`);
  console.log(`  Skipped (dup/non-CFP): ${skipped}`);
  console.log(`  Pipeline total (open): ${open.length}`);
  console.log('─'.repeat(50));

  // Surface urgent deadlines
  const today  = new Date().toISOString().split('T')[0];
  const urgent = open.filter(o => o.cfpDeadline && o.cfpDeadline <= new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]);
  if (urgent.length > 0) {
    console.log(`\n⚠️  ${urgent.length} opportunity(ies) with deadline within 7 days:`);
    for (const o of urgent) {
      console.log(`  • ${o.conference} — deadline ${o.cfpDeadline}`);
    }
  }
}

main().catch(err => {
  console.error('Scout failed:', err.message);
  process.exit(1);
});
