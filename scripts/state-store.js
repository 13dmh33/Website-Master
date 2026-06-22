'use strict';

/**
 * Centralized state.json reader/writer.
 *
 * Wraps every read/write of state.json with:
 *   - schema validation (required top-level fields)
 *   - lead count warning (logs, doesn't block) once queue exceeds WARN_LEAD_COUNT
 *   - automatic state.backup.json snapshot before every write
 *
 * Supabase migration path (documented, not yet built):
 *   - `queue`        → table `leads`        (lead_id PK, status, added_at, diagnosed_at, checked_at, built_at, ...)
 *   - `active`       → table `leads` filtered by status (no separate table needed)
 *   - `closed`       → table `leads` filtered by status, or a `deals` table if richer deal data is added
 *   - `nora_pipeline`→ table `nora_pipeline` (lead_id FK → leads, nora_pitch_due, nora_status)
 *   - `daily_stats`  → table `daily_stats` (date PK, counters) — append-only, never overwritten
 *   - `last_run`     → table `agent_runs` (agent_name, ran_at) instead of a single top-level field
 *   Migrate once `queue.length` regularly exceeds ~500-1000 and file read/write latency
 *   or merge conflicts on state.json become a real problem.
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const STATE_PATH     = path.join(ROOT, 'state.json');
const BACKUP_PATH    = path.join(ROOT, 'state.backup.json');
const REQUIRED_FIELDS = ['queue', 'active', 'closed', 'nora_pipeline', 'daily_stats'];
const WARN_LEAD_COUNT = 500;

function validateSchema(state) {
  const missing = REQUIRED_FIELDS.filter(f => !(f in state));
  if (missing.length > 0) {
    throw new Error(`state.json missing required field(s): ${missing.join(', ')}`);
  }
  if (!Array.isArray(state.queue)) {
    throw new Error('state.json "queue" must be an array');
  }
}

function loadState() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  validateSchema(state);
  if (state.queue.length > WARN_LEAD_COUNT) {
    console.warn(`[state-store] WARNING: queue has ${state.queue.length} leads (>${WARN_LEAD_COUNT}). Consider migrating to Supabase — see scripts/state-store.js header.`);
  }
  return state;
}

function saveState(state) {
  validateSchema(state);
  if (fs.existsSync(STATE_PATH)) {
    fs.copyFileSync(STATE_PATH, BACKUP_PATH);
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState, validateSchema, STATE_PATH, WARN_LEAD_COUNT };
