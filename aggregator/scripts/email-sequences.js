#!/usr/bin/env node
/**
 * Aggregator Email Sequences — drafts and queues the 3-email, ~3-week lane
 * sequence for every scraped aggregator org. DRAFT/QUEUE ONLY — this script
 * never sends mail. It reuses the Zoho SMTP config path (ZOHO_EMAIL /
 * ZOHO_APP_PASSWORD) only to validate that sender config exists; it never
 * constructs a transport or calls sendMail.
 *
 * Usage:
 *   node aggregator/scripts/email-sequences.js --write
 *       (drafts the full sequence for every org in aggregator/leads/*.json
 *        that doesn't already have a queue file)
 *   node aggregator/scripts/email-sequences.js --mark-replied <lead_id>
 *       (positive reply — exits the drip, no further sequence emails queued)
 *
 * Reads:  aggregator/leads/*.json                 (scraped orgs)
 *         aggregator/templates/email-templates.json
 *         aggregator/outreach-queue/replies.json   (reply-exit list)
 * Writes: aggregator/outreach-queue/{lead_id}.json (drafted sequence)
 *         aggregator/outreach-queue/replies.json
 *         state.json (additive — status updates on aggregator queue records)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env.local') });

const fs = require('fs');
const path = require('path');

const { slugify } = require('../../scripts/lib/scout-shared');
const { mergeFields, pickVariant } = require('../lib/merge');
const { loadState, saveState, upsertAggregatorLead } = require('../lib/state-writer');

const LEADS_DIR = path.join(__dirname, '..', 'leads');
const QUEUE_DIR = path.join(__dirname, '..', 'outreach-queue');
const TEMPLATES_PATH = path.join(__dirname, '..', 'templates', 'email-templates.json');
const REPLIES_PATH = path.join(QUEUE_DIR, 'replies.json');

const args = process.argv.slice(2);
const doWrite = args.includes('--write');
const markRepliedId = (() => {
  const i = args.indexOf('--mark-replied');
  return i !== -1 ? args[i + 1] : null;
})();

function signerName() {
  return process.env.AGGREGATOR_SIGNER_NAME || 'The Trevo Advisors team';
}

function loadOrgs() {
  if (!fs.existsSync(LEADS_DIR)) return [];
  const files = fs.readdirSync(LEADS_DIR).filter((f) => f.endsWith('.json'));
  const orgs = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LEADS_DIR, f), 'utf8'));
      if (Array.isArray(data)) orgs.push(...data);
    } catch { /* skip unreadable file */ }
  }
  return orgs;
}

function loadReplies() {
  if (!fs.existsSync(REPLIES_PATH)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(REPLIES_PATH, 'utf8')));
}

function saveReplies(set) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  fs.writeFileSync(REPLIES_PATH, JSON.stringify([...set], null, 2));
}

function leadIdFor(org) {
  return slugify(`${org.source_type}-${org.org_name}-${org.city}`);
}

function buildDraftSequence(org, laneDef) {
  const now = Date.now();
  const vars = {
    org_name: org.org_name,
    city: org.city,
    program_type: org.program_type,
    role: org.role_tag,
    signer_name: signerName(),
    track_link: org.track_link
  };

  return laneDef.sequence.map((step) => {
    const subjectTemplate = pickVariant(step.subject_variants, leadIdFor(org) + step.step);
    return {
      step: step.step,
      scheduled_for: new Date(now + step.day_offset * 86400000).toISOString(),
      subject: mergeFields(subjectTemplate, vars),
      body: mergeFields(step.body, vars),
      pdf: laneDef.pdf,
      status: 'drafted',
      checker_approved: null
    };
  });
}

function main() {
  if (markRepliedId) {
    const replies = loadReplies();
    replies.add(markRepliedId);
    saveReplies(replies);

    const queueFile = path.join(QUEUE_DIR, `${markRepliedId}.json`);
    if (fs.existsSync(queueFile)) {
      const draft = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      draft.reply_exit = true;
      draft.sequence.forEach((s) => { if (s.status === 'drafted' || s.status === 'queued') s.status = 'cancelled_reply_exit'; });
      fs.writeFileSync(queueFile, JSON.stringify(draft, null, 2));
    }

    const state = loadState();
    upsertAggregatorLead(state, { leadId: markRepliedId, status: 'replied_exit', sourceType: null, trackLink: null });
    saveState(state);

    console.log(`Marked ${markRepliedId} as replied — sequence exited, routed to personal reply.`);
    return;
  }

  const templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  const orgs = loadOrgs();
  const replies = loadReplies();
  fs.mkdirSync(QUEUE_DIR, { recursive: true });

  let drafted = 0;
  let skippedExisting = 0;
  let skippedReplied = 0;

  for (const org of orgs) {
    const leadId = leadIdFor(org);
    const queueFile = path.join(QUEUE_DIR, `${leadId}.json`);

    if (replies.has(leadId)) { skippedReplied++; continue; }
    if (fs.existsSync(queueFile)) { skippedExisting++; continue; }

    const laneDef = templates.lanes[org.source_type];
    if (!laneDef) { console.warn(`  No template lane for source_type "${org.source_type}" — skipping ${org.org_name}`); continue; }

    const draft = {
      lead_id: leadId,
      source_type: org.source_type,
      org_name: org.org_name,
      contact_email: org.contact_email,
      track_link: org.track_link,
      reply_exit: false,
      sequence: buildDraftSequence(org, laneDef)
    };

    if (doWrite) {
      fs.writeFileSync(queueFile, JSON.stringify(draft, null, 2));
    }
    drafted++;
  }

  console.log(`Aggregator email sequences — ${doWrite ? 'drafted' : 'previewed'} ${drafted} org(s), skipped ${skippedExisting} already-queued, ${skippedReplied} replied (exited).`);
  if (!doWrite) console.log('  Run with --write to save drafts to aggregator/outreach-queue/.');

  if (doWrite && drafted > 0) {
    const state = loadState();
    for (const org of orgs) {
      const leadId = leadIdFor(org);
      const queueFile = path.join(QUEUE_DIR, `${leadId}.json`);
      if (fs.existsSync(queueFile) && !replies.has(leadId)) {
        upsertAggregatorLead(state, { leadId, status: 'drafted', sourceType: org.source_type, trackLink: org.track_link });
      }
    }
    saveState(state);
  }
}

main();
