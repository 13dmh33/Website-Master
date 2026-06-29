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

const STATE_PATH = path.join(__dirname, '..', 'state.json');
const LEADS_DIR = path.join(__dirname, '..', 'leads');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/sheet-import.js <path-to-curated-json>');
  process.exit(1);
}

const leads = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const knownIds = new Set(
  state.queue.map(l => l.lead_id)
    .concat(state.active.map(l => l.lead_id))
    .concat(state.closed.map(l => l.lead_id))
);

const newLeads = leads.filter(l => !knownIds.has(l.lead_id));
const skipped = leads.length - newLeads.length;

if (newLeads.length === 0) {
  console.log(`All ${leads.length} leads already known (skipped ${skipped}). Nothing to import.`);
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

console.log(`Imported ${newLeads.length} leads (skipped ${skipped} already known) -> leads/${outFile}`);
console.log(`Queued ${newLeads.length} into state.json (status: scouted)`);
