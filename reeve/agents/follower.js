'use strict';

// follower.js — draft follow-up emails for pitches with no response after 14 days
//
// Checks the pitches directory for sent pitches older than FOLLOWUP_DAYS with no
// response recorded. Drafts a short follow-up email for each. Dave reviews via:
//   node scripts/review-drafts.js
//
// Usage:
//   node agents/follower.js
//   node agents/follower.js --days 10       (custom threshold, default 14)
//   node agents/follower.js --dry-run

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs          = require('fs');
const path        = require('path');
const Anthropic   = require('@anthropic-ai/sdk');
const clientStore = require('../lib/client-store');
const oppStore    = require('../lib/opportunity-store');

const isDryRun    = process.argv.includes('--dry-run');
const daysArg     = (() => { const i = process.argv.indexOf('--days'); return i !== -1 ? parseInt(process.argv[i + 1], 10) : 14; })();
const FOLLOWUP_DAYS = isNaN(daysArg) ? 14 : daysArg;
const MODEL       = 'claude-sonnet-4-6';

const DRAFTS_DIR  = path.join(__dirname, '..', 'output', 'pitches');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

const client_ai   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(isoString) {
  if (!isoString) return -1;
  return (Date.now() - new Date(isoString).getTime()) / 86400000;
}

function generateDraftId() {
  return `followup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function saveDraft(draft) {
  const p = path.join(DRAFTS_DIR, `${draft.id}.json`);
  fs.writeFileSync(p, JSON.stringify(draft, null, 2), 'utf8');
  return draft;
}

// Load all draft files
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

// ── Claude follow-up generation ───────────────────────────────────────────────

async function draftFollowUp(speaker, opportunity, originalPitch) {
  const daysSent = Math.round(daysSince(originalPitch.sentAt));

  const prompt = `You are a follow-up writer for Reeve, a speaker booking agency. Write a short follow-up email to a conference organizer who hasn't responded to a pitch sent ${daysSent} days ago.

CONTEXT:
Speaker: ${speaker.name}
Talk: ${speaker.talkTitle}
Conference: ${opportunity.conference}
Original subject line: ${originalPitch.subject}
Days since pitch sent: ${daysSent}

Write a follow-up email. Guidelines:
- Subject: "Re: ${originalPitch.subject}" or a slightly varied version
- 2–4 sentences max. Don't repeat the full pitch.
- Reference the original email briefly ("following up on my note about ${speaker.name}")
- A single clear question: "Is this on your radar for ${opportunity.conference}?"
- No groveling, no "I know you're busy", no pressure.
- Sign as: "Dave | Reeve"
- Tone: warm, confident, brief.

Return ONLY a JSON object with no markdown:
{
  "subject": "...",
  "body": "..."
}`;

  const response = await client_ai.messages.create({
    model:      MODEL,
    max_tokens: 300,
    messages:   [{ role: 'user', content: prompt }]
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[follower] Could not parse Claude response as JSON:', cleaned.slice(0, 200));
    throw new Error(`Follow-up draft JSON parse failed for pitch ${pitch.id}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFollower starting${isDryRun ? ' [DRY RUN]' : ''} (threshold: ${FOLLOWUP_DAYS} days)...`);
  console.log('─'.repeat(50));

  const allDrafts = loadAllDrafts();

  // Find sent pitches with no response, past the threshold
  const sentPitches = allDrafts.filter(d =>
    d.type === 'pitch' &&
    d.status === 'sent' &&
    !d.response &&
    daysSince(d.sentAt) >= FOLLOWUP_DAYS
  );

  if (!sentPitches.length) {
    console.log(`No sent pitches older than ${FOLLOWUP_DAYS} days without a response.`);
    process.exit(0);
  }

  console.log(`Found ${sentPitches.length} pitch(es) eligible for follow-up.\n`);

  let drafted = 0, skipped = 0;

  for (const pitch of sentPitches) {
    // Check we haven't already drafted a follow-up for this pitch
    const alreadyFollowedUp = allDrafts.some(d =>
      d.type === 'followup' &&
      d.originalPitchId === pitch.id &&
      ['draft', 'approved', 'sent'].includes(d.status)
    );

    if (alreadyFollowedUp) {
      console.log(`  ${pitch.conference?.slice(0, 50)} — follow-up already drafted`);
      skipped++;
      continue;
    }

    const speaker     = clientStore.getClient(pitch.clientId);
    const opportunity = oppStore.getOpportunity(pitch.opportunityId);

    if (!speaker || !opportunity) {
      console.log(`  ${pitch.id} — missing client or opportunity, skipping`);
      skipped++;
      continue;
    }

    const daysSent = Math.round(daysSince(pitch.sentAt));
    console.log(`  → ${opportunity.conference.slice(0, 60)} (sent ${daysSent}d ago)`);

    if (isDryRun) {
      console.log('    [dry run — not calling Claude]');
      drafted++;
      continue;
    }

    let content;
    try {
      content = await draftFollowUp(speaker, opportunity, pitch);
    } catch (err) {
      console.log(`    ✗ Claude error: ${err.message}`);
      continue;
    }

    const draft = saveDraft({
      id:             generateDraftId(),
      type:           'followup',
      status:         'draft',
      originalPitchId: pitch.id,
      clientId:       speaker.id,
      clientName:     speaker.name,
      opportunityId:  opportunity.id,
      conference:     opportunity.conference,
      to:             pitch.to || null,
      subject:        content.subject,
      body:           content.body,
      createdAt:      new Date().toISOString(),
      reviewedAt:     null,
      sentAt:         null,
      rejectionNote:  null,
    });

    console.log(`    ✓ Follow-up drafted: ${draft.id}`);
    drafted++;
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Done. Drafted: ${drafted} | Skipped: ${skipped}`);
  if (drafted > 0 && !isDryRun) {
    console.log('\nReview with: node scripts/review-drafts.js');
  }
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Follower failed:', err.message);
  process.exit(1);
});
