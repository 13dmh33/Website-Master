/**
 * aggregator/lib/state-writer — additive writes to the root state.json.
 *
 * Hard rule: never touch an existing record or existing top-level key.
 * Aggregator leads get pushed into the same `queue` array as the Trevo
 * cold-outreach pipeline (so dashboard/reporter tooling that scans `queue`
 * sees them too), tagged with `lane: 'aggregator'` so they're easy to filter
 * out of existing Trevo-pipeline logic that doesn't expect them. A new
 * top-level `aggregator` stats block is added if it doesn't already exist —
 * existing top-level keys (`queue`, `active`, `closed`, `nora_pipeline`,
 * `daily_stats`, `last_run`) are read and rewritten verbatim.
 */

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', '..', 'state.json');

function loadState() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!state.aggregator) {
    state.aggregator = { total_orgs: 0, total_drafted: 0, last_run: null };
  }
  return state;
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// orgLeadId must be stable across runs (used for upsert) — callers pass the
// same slug used as the org's queue dir filename.
function upsertAggregatorLead(state, { leadId, status, sourceType, trackLink }) {
  const existing = state.queue.find((l) => l.lead_id === leadId && l.lane === 'aggregator');
  if (existing) {
    existing.status = status;
    existing.updated_at = new Date().toISOString();
    return existing;
  }
  const record = {
    lead_id: leadId,
    status,
    lane: 'aggregator',
    source_type: sourceType,
    track_link: trackLink,
    added_at: new Date().toISOString()
  };
  state.queue.push(record);
  return record;
}

function recordAggregatorRun(state, { newOrgCount, drafted }) {
  state.aggregator.total_orgs = (state.aggregator.total_orgs || 0) + (newOrgCount || 0);
  state.aggregator.total_drafted = (state.aggregator.total_drafted || 0) + (drafted || 0);
  state.aggregator.last_run = new Date().toISOString();
}

module.exports = { loadState, saveState, upsertAggregatorLead, recordAggregatorRun };
