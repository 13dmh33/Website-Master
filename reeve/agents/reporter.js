'use strict';

// reporter.js — weekly client digest
//
// Generates a summary email for each active client showing:
//   - Pitches submitted this week
//   - Responses received (accepted / declined / no response)
//   - Open pipeline (pending pitches, upcoming deadlines)
//   - Next actions Reeve is taking
//
// All output is saved as drafts. Dave reviews before sending via:
//   node scripts/review-drafts.js --type report
//
// Usage:
//   node agents/reporter.js                 (draft reports for all active clients)
//   node agents/reporter.js --client <id>   (one client only)
//   node agents/reporter.js --dry-run

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs          = require('fs');
const path        = require('path');
const Anthropic   = require('@anthropic-ai/sdk');
const clientStore = require('../lib/client-store');
const oppStore    = require('../lib/opportunity-store');
const { rankOpportunities } = require('../lib/matching');

const isDryRun  = process.argv.includes('--dry-run');
const clientArg = (() => { const i = process.argv.indexOf('--client'); return i !== -1 ? process.argv[i + 1] : null; })();
const MODEL     = 'claude-sonnet-4-6';

const DRAFTS_DIR = path.join(__dirname, '..', 'output', 'pitches');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

const client_ai  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateDraftId() {
  return `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function saveDraft(draft) {
  const p = path.join(DRAFTS_DIR, `${draft.id}.json`);
  fs.writeFileSync(p, JSON.stringify(draft, null, 2), 'utf8');
  return draft;
}

function loadAllDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

// ── Build client pipeline summary ─────────────────────────────────────────────

function buildClientSummary(speaker, allDrafts) {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // All pitches for this client
  const clientDrafts = allDrafts.filter(d => d.clientId === speaker.id);
  const sentPitches  = clientDrafts.filter(d => d.type === 'pitch' && d.status === 'sent');
  const sentThisWeek = sentPitches.filter(d => d.sentAt >= oneWeekAgo);

  // Responses
  const accepted    = sentPitches.filter(d => d.response === 'accepted');
  const declined    = sentPitches.filter(d => d.response === 'declined');
  const waitlisted  = sentPitches.filter(d => d.response === 'waitlisted');
  const respondedThisWeek = sentPitches.filter(d => d.response && d.respondedAt >= oneWeekAgo);

  // Pending (sent, no response)
  const pending = sentPitches.filter(d => !d.response);

  // Open opportunities not yet pitched for this client
  const openOpps = oppStore.getOpenOpportunities();
  const unpitched = openOpps.filter(opp =>
    !sentPitches.some(d => d.opportunityId === opp.id)
  );

  // Rank unpitched opps the same way pitcher.js will when it next runs, so
  // the client sees a preview of what's coming rather than a raw count.
  const rankedUnpitched = rankOpportunities(speaker, unpitched);
  const noFitInPipeline = openOpps.length > 0 && rankedUnpitched.length === 0;

  // Upcoming deadlines (next 14 days) in their open pipeline
  const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  const urgentOpps  = pending
    .map(d => oppStore.getOpportunity(d.opportunityId))
    .filter(Boolean)
    .filter(opp => opp.cfpDeadline && opp.cfpDeadline <= twoWeeksOut);

  return {
    sentThisWeek:      sentThisWeek.length,
    respondedThisWeek: respondedThisWeek.length,
    accepted:          accepted.length,
    declined:          declined.length,
    waitlisted:        waitlisted.length,
    pendingTotal:      pending.length,
    unpitchedOpps:     rankedUnpitched.length,
    noFitInPipeline,
    urgentDeadlines:   urgentOpps.length,
    // detail lists for Claude to narrate
    sentThisWeekList:  sentThisWeek.map(d => d.conference).slice(0, 5),
    pendingList:       pending.map(d => d.conference).slice(0, 5),
    urgentList:        urgentOpps.map(o => `${o.conference} (deadline ${o.cfpDeadline})`).slice(0, 3),
    upcomingMatchesList: rankedUnpitched.slice(0, 3).map(({ opp }) => opp.conference),
  };
}

// ── Claude report generation ──────────────────────────────────────────────────

async function draftReport(speaker, summary) {
  const prompt = `You are writing a weekly update email from Dave at Reeve (a speaker booking agency) to a client.

CLIENT:
Name: ${speaker.name}
Talk: ${speaker.talkTitle}
Retainer: ${speaker.retainerTier === 'full' ? 'Full pipeline ($997/mo)' : 'Starter ($597/mo)'}

PIPELINE STATS THIS WEEK:
- Pitches sent this week: ${summary.sentThisWeek}
  ${summary.sentThisWeekList.length ? '  Conferences: ' + summary.sentThisWeekList.join('; ') : '  (none this week)'}
- Responses received this week: ${summary.respondedThisWeek}
- Total accepted: ${summary.accepted}
- Total declined: ${summary.declined}
- Awaiting response: ${summary.pendingTotal}
${summary.urgentList.length ? `- Urgent deadlines (14 days): ${summary.urgentList.join('; ')}` : ''}
${summary.upcomingMatchesList.length ? `- Matching opportunities lined up to pitch next: ${summary.upcomingMatchesList.join('; ')}` : ''}
${summary.noFitInPipeline ? `- NOTE: scout currently has open opportunities in the pipeline, but none match this client's topics well — mention scout is actively widening its search for their niche, do NOT say pipeline is empty` : ''}

Write a brief weekly update email from Dave to ${speaker.name}. Guidelines:
- Subject: "Your Reeve pipeline — week of [current week]" (use the real date)
- Opening: 1 sentence — what happened this week, positively framed
- Body: 2–3 short bullets covering: what was submitted, what's pending, what's next
- If accepted opportunities exist: one line of genuine congratulations
- If no pitches sent: acknowledge it, explain next steps (scout is finding new conferences)
- If there are matching opportunities lined up to pitch next, name one or two
- Closing: confident and forward-looking. "We'll be pitching [X] next week" if there are open opps
- Sign off: "Dave | Reeve"
- Tone: professional, warm, brief. Client should feel like their pipeline is being actively managed.
- Length: under 150 words

Return ONLY a JSON object with no markdown:
{
  "subject": "...",
  "body": "..."
}`;

  const response = await client_ai.messages.create({
    model:      MODEL,
    max_tokens: 500,
    messages:   [{ role: 'user', content: prompt }]
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[reporter] Could not parse Claude response as JSON:', cleaned.slice(0, 200));
    throw new Error(`Report draft JSON parse failed for ${speaker.name}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nReporter starting${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  const clients = clientArg
    ? [clientStore.getClient(clientArg)].filter(Boolean)
    : clientStore.getActiveClients();

  if (!clients.length) {
    console.log('No active clients. Run: node scripts/onboard-client.js');
    process.exit(0);
  }

  const allDrafts = loadAllDrafts();
  let drafted = 0;

  for (const speaker of clients) {
    console.log(`\n── ${speaker.name} ──`);

    const summary = buildClientSummary(speaker, allDrafts);
    console.log(`  Pitches this week: ${summary.sentThisWeek} | Pending: ${summary.pendingTotal} | Accepted: ${summary.accepted}`);

    if (isDryRun) {
      console.log('  [dry run — not calling Claude]');
      drafted++;
      continue;
    }

    let content;
    try {
      content = await draftReport(speaker, summary);
    } catch (err) {
      console.log(`  ✗ Claude error: ${err.message}`);
      continue;
    }

    if (!speaker.email) {
      console.warn(`  ⚠ ${speaker.name} has no email address — report will save but cannot be sent.`);
    }

    const draft = saveDraft({
      id:          generateDraftId(),
      type:        'report',
      status:      'draft',
      clientId:    speaker.id,
      clientName:  speaker.name,
      to:          speaker.email || null,
      subject:     content.subject,
      body:        content.body,
      summary,
      createdAt:   new Date().toISOString(),
      reviewedAt:  null,
      sentAt:      null,
      rejectionNote: null,
    });

    console.log(`  ✓ Report drafted: ${draft.id}`);
    console.log(`  Subject: ${draft.subject}`);
    drafted++;
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Done. Reports drafted: ${drafted}`);
  if (drafted > 0 && !isDryRun) {
    console.log('\nReview with: node scripts/review-drafts.js --type report');
  }
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Reporter failed:', err.message);
  process.exit(1);
});
