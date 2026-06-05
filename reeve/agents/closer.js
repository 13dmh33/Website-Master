'use strict';

// closer.js — draft closing emails when a conference accepts a pitch
//
// Drafts two emails for each accepted pitch:
//   1. To conference organizer: logistics confirmation (A/V, bio, fee, travel rider)
//   2. To client/speaker: good news email with next steps
//
// Both are saved as drafts for Dave to review before sending:
//   node scripts/review-drafts.js --type closer
//
// Usage:
//   node agents/closer.js                    (process all newly accepted pitches)
//   node agents/closer.js --pitch <pitchId>  (one pitch only, by ID)
//   node agents/closer.js --dry-run

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs          = require('fs');
const path        = require('path');
const Anthropic   = require('@anthropic-ai/sdk');
const clientStore = require('../lib/client-store');
const oppStore    = require('../lib/opportunity-store');

const isDryRun  = process.argv.includes('--dry-run');
const pitchArg  = (() => { const i = process.argv.indexOf('--pitch'); return i !== -1 ? process.argv[i + 1] : null; })();
const MODEL     = 'claude-sonnet-4-6';

const DRAFTS_DIR = path.join(__dirname, '..', 'output', 'pitches');
if (!fs.existsSync(DRAFTS_DIR)) fs.mkdirSync(DRAFTS_DIR, { recursive: true });

const client_ai  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Draft persistence ─────────────────────────────────────────────────────────

function generateDraftId() {
  return `closer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
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

function closerAlreadyDrafted(pitchId) {
  return loadAllDrafts().some(d =>
    d.type === 'closer' &&
    d.originalPitchId === pitchId &&
    ['draft', 'approved', 'sent'].includes(d.status)
  );
}

// ── Claude drafting ───────────────────────────────────────────────────────────

async function draftConferenceConfirmation(speaker, opportunity, pitch) {
  const prompt = `You are writing a confirmation email from Dave at Reeve (a speaker booking agency) to a conference organizer who has accepted a speaker pitch.

SPEAKER:
Name: ${speaker.name}
Talk title: ${speaker.talkTitle}
Available durations: ${speaker.talkDurations?.map(d => `${d} min`).join(', ') || '45 min'}
Fee: ${speaker.fee?.min ? `$${speaker.fee.min.toLocaleString()}` : 'as discussed'}
Bio: ${speaker.bio || '(will provide)'}

CONFERENCE:
Name: ${opportunity.conference}
Event date: ${opportunity.eventDate || 'TBD — confirm with organizer'}
Notes: ${pitch.responseNotes || 'none'}

Write a confirmation email to the conference organizer. Guidelines:
- Subject: "Confirmed: ${speaker.name} for [conference name]"
- Opening: thank them for the acceptance — one brief sentence
- Confirm the key details: talk title, duration, fee
- State what Reeve will provide and when: bio + headshot within 48 hours; A/V requirements on request; travel logistics once event date confirmed
- Ask: do they have a speaker agreement template, or should Reeve send one?
- One sentence on travel rider: Reeve handles all speaker logistics, just let us know hotel dates needed
- Close with a single clear ask: confirm the event date and point of contact going forward
- Sign off: "Dave | Reeve"
- Tone: professional, confident, organized. This is a business confirming a booking — not a fan.
- Length: under 160 words

Return ONLY a JSON object with no markdown:
{
  "subject": "...",
  "body": "..."
}`;

  const response = await client_ai.messages.create({
    model:      MODEL,
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function draftClientUpdate(speaker, opportunity, pitch) {
  const fee = speaker.fee?.min
    ? `$${speaker.fee.min.toLocaleString()}${speaker.fee.max && speaker.fee.max !== speaker.fee.min ? `–$${speaker.fee.max.toLocaleString()}` : ''}`
    : 'your fee';

  const prompt = `You are Dave at Reeve (a speaker booking agency) writing a "good news" email to a client speaker.

SPEAKER: ${speaker.name}
CONFERENCE: ${opportunity.conference}
EVENT DATE: ${opportunity.eventDate || 'TBD'}
FEE: ${fee}
TALK: ${speaker.talkTitle}
NOTES: ${pitch.responseNotes || 'none'}

Write a brief "you got it" update email to ${speaker.name}. Guidelines:
- Subject: "You're in — [conference name]"
- Opening: one sentence of genuine congratulations. Specific, not generic.
- Key details bullet: conference name, event date (or TBD), fee confirmed
- What Reeve is handling next: speaker agreement, logistics, point of contact
- What they need to do (if anything): confirm bio is current, send headshot if not on file
- One forward-looking line: "this is exactly the kind of stage Reeve is building toward"
- Sign off: "Dave | Reeve"
- Tone: warm but efficient. They hired Reeve to do the work — acknowledge the win, state the next step, keep it moving.
- Length: under 120 words

Return ONLY a JSON object with no markdown:
{
  "subject": "...",
  "body": "..."
}`;

  const response = await client_ai.messages.create({
    model:      MODEL,
    max_tokens: 500,
    messages:   [{ role: 'user', content: prompt }],
  });

  const raw     = response.content[0].text.trim();
  const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nCloser starting${isDryRun ? ' [DRY RUN]' : ''}...`);
  console.log('─'.repeat(50));

  const allDrafts = loadAllDrafts();

  // Find accepted pitches that haven't been closed yet
  let acceptedPitches = allDrafts.filter(d =>
    (d.type === 'pitch' || d.type === 'followup') &&
    d.status === 'sent' &&
    d.response === 'accepted'
  );

  if (pitchArg) {
    acceptedPitches = acceptedPitches.filter(d => d.id === pitchArg);
    if (!acceptedPitches.length) {
      // Also check if the pitch exists but isn't accepted yet — helpful error
      const found = allDrafts.find(d => d.id === pitchArg);
      if (found) {
        console.log(`Pitch ${pitchArg} found but response is "${found.response || 'not recorded'}".`);
        console.log('Record the accepted response first: node scripts/record-response.js --id ' + pitchArg);
      } else {
        console.log(`No pitch found with ID: ${pitchArg}`);
      }
      process.exit(0);
    }
  }

  if (!acceptedPitches.length) {
    console.log('No accepted pitches found — nothing to close.');
    console.log('When a conference accepts: node scripts/record-response.js');
    process.exit(0);
  }

  let drafted = 0, skipped = 0;

  for (const pitch of acceptedPitches) {
    console.log(`\n── ${pitch.conference?.slice(0, 55)} ──`);
    console.log(`   Client: ${pitch.clientName} | Pitch: ${pitch.id}`);

    if (closerAlreadyDrafted(pitch.id)) {
      console.log('   Closer already drafted — skipping.');
      skipped++;
      continue;
    }

    const speaker     = clientStore.getClient(pitch.clientId);
    const opportunity = oppStore.getOpportunity(pitch.opportunityId);

    if (!speaker) {
      console.log(`   ✗ Client not found: ${pitch.clientId} — skipping`);
      skipped++;
      continue;
    }

    if (!opportunity) {
      console.log(`   ✗ Opportunity not found: ${pitch.opportunityId} — using pitch data only`);
    }

    const opp = opportunity || {
      conference:   pitch.conference,
      eventDate:    null,
      topics:       [],
      fee:          'as discussed',
    };

    if (isDryRun) {
      console.log('   [dry run — not calling Claude]');
      drafted += 2;
      continue;
    }

    // Draft 1: Conference confirmation
    let confContent, clientContent;
    try {
      confContent = await draftConferenceConfirmation(speaker, opp, pitch);
    } catch (err) {
      console.log(`   ✗ Claude error (conference email): ${err.message}`);
      skipped++;
      continue;
    }

    // Draft 2: Client good-news update
    try {
      clientContent = await draftClientUpdate(speaker, opp, pitch);
    } catch (err) {
      console.log(`   ✗ Claude error (client email): ${err.message}`);
      skipped++;
      continue;
    }

    const baseId = generateDraftId();

    // Save conference confirmation draft
    const confDraft = saveDraft({
      id:              baseId,
      type:            'closer',
      closerType:      'conference_confirmation',
      status:          'draft',
      originalPitchId: pitch.id,
      clientId:        speaker.id,
      clientName:      speaker.name,
      opportunityId:   pitch.opportunityId || null,
      conference:      pitch.conference,
      to:              pitch.to || null,   // conference organizer — may already be on file
      subject:         confContent.subject,
      body:            confContent.body,
      createdAt:       new Date().toISOString(),
      reviewedAt:      null,
      sentAt:          null,
      rejectionNote:   null,
    });

    // Save client update draft
    const clientDraft = saveDraft({
      id:              `${baseId}-client`,
      type:            'closer',
      closerType:      'client_update',
      status:          'draft',
      originalPitchId: pitch.id,
      clientId:        speaker.id,
      clientName:      speaker.name,
      opportunityId:   pitch.opportunityId || null,
      conference:      pitch.conference,
      to:              speaker.email,
      subject:         clientContent.subject,
      body:            clientContent.body,
      createdAt:       new Date().toISOString(),
      reviewedAt:      null,
      sentAt:          null,
      rejectionNote:   null,
    });

    // Update client profile: increment bookings_confirmed
    try {
      const current = speaker.bookings_confirmed || 0;
      clientStore.updateClient(speaker.id, { bookings_confirmed: current + 1 });
    } catch { /* non-fatal */ }

    console.log(`   ✓ Conference confirmation draft: ${confDraft.id}`);
    console.log(`     Subject: ${confDraft.subject}`);
    console.log(`   ✓ Client update draft: ${clientDraft.id}`);
    console.log(`     Subject: ${clientDraft.subject}`);
    drafted += 2;
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Done. Drafted: ${drafted} email(s) | Skipped: ${skipped}`);
  if (drafted > 0 && !isDryRun) {
    console.log('\nReview and send:');
    console.log('  node scripts/review-drafts.js --type closer');
  }
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Closer failed:', err.message);
  process.exit(1);
});
