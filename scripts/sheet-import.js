/**
 * sheet-import — one-off importer for manually-curated leads pulled from the
 * user's Google Sheet (company/URL/phone/email table). Not a scraper — reads
 * a local curated JSON array (see data/sheet-import-2026-06-29.json) and
 * mirrors it into leads/ + state.json's queue, same contract Scout uses.
 *
 * Usage: node scripts/sheet-import.js <path-to-curated-json>
 */
const fs = require('fs');
const path = require('path');
const { syncFromState: syncDoNotContact, isContactSuppressed } = require('./lib/do-not-contact');

const STATE_PATH = path.join(__dirname, '..', 'state.json');
const LEADS_DIR = path.join(__dirname, '..', 'leads');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/sheet-import.js <path-to-curated-json>');
  process.exit(1);
}

const leads = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
syncDoNotContact({}); // refresh the do-not-contact store from canonical opt-outs before ingesting
const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const knownIds = new Set(
  state.queue.map(l => l.lead_id)
    .concat(state.active.map(l => l.lead_id))
    .concat(state.closed.map(l => l.lead_id))
);

// Reject any lead whose contact (email/phone/domain) is on the do-not-contact list —
// this is the cross-campaign guarantee: an opted-out business re-curated under a NEW
// lead_id is caught here (knownIds only catches the exact same id).
const suppressedLeads = leads.filter(l => isContactSuppressed({ email: l.email, phone: l.phone, website: l.url || l.website }));
const suppressedCount = suppressedLeads.length;
const newLeads = leads.filter(l => !knownIds.has(l.lead_id) &&
  !isContactSuppressed({ email: l.email, phone: l.phone, website: l.url || l.website }));
const skipped = leads.length - newLeads.length - suppressedCount;

if (newLeads.length === 0) {
  console.log(`Nothing to import: ${leads.length} leads (${skipped} already known, ${suppressedCount} on do-not-contact).`);
  process.exit(0);
}

if (!fs.existsSync(LEADS_DIR)) fs.mkdirSync(LEADS_DIR, { recursive: true });
const outFile = `sheet-import-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(path.join(LEADS_DIR, outFile), JSON.stringify(newLeads, null, 2));

const now = new Date().toISOString();
for (const l of newLeads) {
  state.queue.push({ lead_id: l.lead_id, status: 'scouted', added_at: now });
}
fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

console.log(`Imported ${newLeads.length} leads (skipped ${skipped} already known, ${suppressedCount} on do-not-contact) -> leads/${outFile}`);
console.log(`Queued ${newLeads.length} into state.json (status: scouted)`);
