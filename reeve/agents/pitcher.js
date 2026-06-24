'use strict';

// pitcher.js — draft pitch emails for active clients against open conferences
//
// Matches each client's topics to open CFP opportunities, then uses Claude to
// write a pitch email in Reeve's voice. All output is saved as drafts —
// nothing sends until Dave approves via: node scripts/review-drafts.js
//
// Usage:
//   node agents/pitcher.js                    (draft pitches for all active clients)
//   node agents/pitcher.js --client <id>      (one client only)
//   node agents/pitcher.js --dry-run          (log matches, don't call Claude)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs          = require('fs');
const path        = require('path');
const Anthropic   = require('@anthropic-ai/sdk');
const clientStore = require('../lib/client-store');
const oppStore    = require('../lib/opportunity-store');
const { matchScore, feeFitMultiplier } = require('../lib/matching');

const isDryRun    = process.argv.includes('--dry-run');
const clientArg   = (() => { const i = process.argv.indexOf('--client'); return i !== -1 ? process.argv[i + 1] : null; })();
const MODEL       = 'claude-sonnet-4-6';

const DRAFTS_DIR  = path.join(__dirname, '..', 'output', 'pitches');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

const client_ai   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Draft persistence ─────────────────────────────────────────────────────────

function generateDraftId() {
  return `pitch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function saveDraft(draft) {
  const p = path.join(DRAFTS_DIR, `${draft.id}.json`);
  fs.writeFileSync(p, JSON.stringify(draft, null, 2), 'utf8');
  return draft;
}

function draftAlreadyExists(clientId, oppId) {
  // Don't re-draft if we already have a draft or sent pitch for this client+opp pair
  return fs.readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith('.json'))
    .some(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8'));
        return d.clientId === clientId && d.opportunityId === oppId &&
               ['draft', 'approved', 'sent'].includes(d.status);
      } catch { return false; }
    });
}

// ── Claude pitch generation ───────────────────────────────────────────────────

async function draftPitch(speaker, opportunity) {
  const prompt = `You are a pitch writer for Reeve, a speaker booking agency. Write a cold pitch email to a conference organizer on behalf of a speaker Reeve represents.

SPEAKER PROFILE:
Name: ${speaker.name}
Talk title: ${speaker.talkTitle}
Topics/niche: ${speaker.topics?.join(', ') || 'not specified'}
Available durations: ${speaker.talkDurations?.map(d => `${d} min`).join(', ') || '45 min'}
Bio: ${speaker.bio || '(bio not provided — write around it)'}
Fee range: ${speaker.fee?.min ? `$${speaker.fee.min.toLocaleString()}–$${speaker.fee.max?.toLocaleString() || speaker.fee.min.toLocaleString()}` : 'negotiable'}

CONFERENCE / OPPORTUNITY:
Name: ${opportunity.conference}
Topics they want: ${opportunity.topics?.join(', ') || 'not specified'}
CFP deadline: ${opportunity.cfpDeadline || 'not listed'}
Fee offered: ${opportunity.feeAmount?.raw || opportunity.fee || 'unknown'}
URL: ${opportunity.url || 'not available'}
Notes: ${opportunity.notes || 'none'}

Write a pitch email from Reeve (the agency) to the conference. Guidelines:
- Subject line: specific, references the talk or speaker's angle, not generic
- Opening: reference the conference specifically — one sentence that shows we know what it is
- Pitch: 2–3 sentences on why this speaker + their talk is right for this audience
- Credibility: 1–2 sentences from the bio (if available); if not, lead with the talk's value
- Logistics: mention available durations and that we handle all speaker logistics
- Close: simple ask — are they open to a proposal? No pressure.
- Signature: "Dave | Reeve" — nothing more
- Tone: confident, direct, brief. No buzzwords. No "I hope this finds you well."
- Length: under 180 words total

Return ONLY a JSON object with no markdown:
{
  "subject": "...",
  "body": "..."
}`;

  const response = await client_ai.messages.create({
    model:      MODEL,
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }]
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[pitcher] Could not parse Claude response as JSON:', cleaned.slice(0, 200));
    throw new Error(`Pitch draft JSON parse failed for ${speaker.name} / ${opportunity.conference}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nPitcher starting${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  const clients = clientArg
    ? [clientStore.getClient(clientArg)].filter(Boolean)
    : clientStore.getActiveClients();

  if (!clients.length) {
    console.log('No active clients found. Run: node scripts/onboard-client.js');
    process.exit(0);
  }

  const opportunities = oppStore.getOpenOpportunities();
  if (!opportunities.length) {
    console.log('No open opportunities. Run: node agents/conference-scout.js');
    process.exit(0);
  }

  console.log(`Clients: ${clients.length} active | Opportunities: ${opportunities.length} open\n`);

  let drafted = 0, skipped = 0;

  for (const speaker of clients) {
    console.log(`\n── ${speaker.name} (${speaker.id}) ──`);

    // Score and sort opportunities by topic match, deprioritized by fee fit
    const ranked = opportunities
      .map(opp => ({ opp, score: matchScore(speaker.topics, opp.topics) * feeFitMultiplier(speaker.fee, opp.feeAmount) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // max 5 pitches per client per run

    if (!ranked.length) {
      console.log('  No matching opportunities this week.');
      continue;
    }

    for (const { opp, score } of ranked) {
      const matchPct = Math.round(score * 100);
      console.log(`  → ${opp.conference.slice(0, 60)} (match: ${matchPct}%)`);

      if (draftAlreadyExists(speaker.id, opp.id)) {
        console.log('    already drafted/sent — skipping');
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log('    [dry run — not calling Claude]');
        drafted++;
        continue;
      }

      let pitchContent;
      try {
        pitchContent = await draftPitch(speaker, opp);
      } catch (err) {
        console.log(`    ✗ Claude error: ${err.message}`);
        continue;
      }

      const draft = saveDraft({
        id:             generateDraftId(),
        type:           'pitch',
        status:         'draft',
        clientId:       speaker.id,
        clientName:     speaker.name,
        clientEmail:    speaker.email,
        opportunityId:  opp.id,
        conference:     opp.conference,
        cfpDeadline:    opp.cfpDeadline || null,
        opportunityUrl: opp.url || null,
        to:             opp.organizerEmail || null,   // best-effort from scout; Dave fills in on review if still null
        subject:        pitchContent.subject,
        body:           pitchContent.body,
        matchScore:     score,
        createdAt:      new Date().toISOString(),
        reviewedAt:     null,
        sentAt:         null,
        rejectionNote:  null,
      });

      console.log(`    ✓ Draft saved: ${draft.id}`);
      console.log(`    Subject: ${draft.subject}`);
      drafted++;
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Done. Drafted: ${drafted} | Skipped (existing): ${skipped}`);
  if (drafted > 0 && !isDryRun) {
    console.log('\nReview and send drafts with:');
    console.log('  node scripts/review-drafts.js');
  }
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Pitcher failed:', err.message);
  process.exit(1);
});
