'use strict';

// opportunity-store.js — conference/CFP pipeline CRUD for Reeve
// Opportunities live in output/opportunities/{opportunityId}.json
// Created by agents/conference-scout.js each week
// Read by agents/pitcher.js to draft and send pitches

const fs   = require('fs');
const path = require('path');

const OPPS_DIR = path.join(__dirname, '..', 'output', 'opportunities');

if (!fs.existsSync(OPPS_DIR)) {
  fs.mkdirSync(OPPS_DIR, { recursive: true });
}

function oppPath(id) {
  return path.join(OPPS_DIR, `${id}.json`);
}

function generateOppId() {
  const ts   = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 5);
  return `opp-${ts}-${rand}`;
}

// ── Read ──────────────────────────────────────────────────────────────────────

function getOpportunity(id) {
  const p = oppPath(id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[opp-store] Failed to read ${id}:`, err.message);
    return null;
  }
}

function getAllOpportunities() {
  try {
    return fs.readdirSync(OPPS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(OPPS_DIR, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Opportunities still accepting speaker applications
function getOpenOpportunities() {
  const today = new Date().toISOString().split('T')[0];
  return getAllOpportunities().filter(o =>
    o.status === 'open' && (!o.cfpDeadline || o.cfpDeadline >= today)
  );
}

// Opportunities that have been pitched for a specific client but not yet responded
function getPendingPitches(clientId) {
  return getAllOpportunities().filter(o =>
    o.pitches?.some(p => p.clientId === clientId && !p.response)
  );
}

// ── Write ─────────────────────────────────────────────────────────────────────

function saveOpportunity(opp) {
  if (!opp.id) throw new Error('opp.id is required');
  const toWrite = Object.assign({}, opp, {
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(oppPath(opp.id), JSON.stringify(toWrite, null, 2), 'utf8');
  return toWrite;
}

// Create a new opportunity from scout data.
function createOpportunity(data) {
  const now = new Date().toISOString();
  const opp = {
    id:           generateOppId(),
    conference:   data.conference   || '',
    url:          data.url          || null,
    cfpDeadline:  data.cfpDeadline  || null,    // YYYY-MM-DD
    eventDate:    data.eventDate    || null,     // YYYY-MM-DD, if known
    topics:       data.topics       || [],       // e.g. ["leadership", "technology"]
    audienceSize: data.audienceSize || null,
    fee:          data.fee          || 'unknown', // "paid" | "honorarium" | "unpaid" | "unknown"
    location:     data.location     || null,
    virtual:      data.virtual      || false,
    source:       data.source       || null,     // URL where the CFP was found
    notes:        data.notes        || '',
    status:       'open',
    pitches:      [],                            // array of pitch records (added by pitcher.js)
    foundAt:      now,
    updatedAt:    now,
  };
  return saveOpportunity(opp);
}

// Record a pitch attempt against an opportunity.
// pitchData: { clientId, sentAt, subject, bodyPreview, method }
function recordPitch(oppId, pitchData) {
  const opp = getOpportunity(oppId);
  if (!opp) throw new Error(`Opportunity not found: ${oppId}`);
  if (!opp.pitches) opp.pitches = [];
  opp.pitches.push(Object.assign({ response: null, respondedAt: null }, pitchData));
  return saveOpportunity(opp);
}

// Record a response to a pitch (accepted / declined / waitlisted / no-response)
function recordResponse(oppId, clientId, response) {
  const opp = getOpportunity(oppId);
  if (!opp) throw new Error(`Opportunity not found: ${oppId}`);
  const pitch = opp.pitches?.find(p => p.clientId === clientId);
  if (!pitch) throw new Error(`No pitch found for client ${clientId} on opp ${oppId}`);
  pitch.response    = response;
  pitch.respondedAt = new Date().toISOString();
  return saveOpportunity(opp);
}

function closeOpportunity(oppId) {
  const opp = getOpportunity(oppId);
  if (!opp) throw new Error(`Opportunity not found: ${oppId}`);
  return saveOpportunity(Object.assign({}, opp, { status: 'closed' }));
}

// ── Deduplication ─────────────────────────────────────────────────────────────

// Check if a conference URL has already been indexed this cycle.
// Prevents scout from re-adding the same CFP each week.
function isDuplicate(url) {
  if (!url) return false;
  return getAllOpportunities().some(o => o.url === url || o.source === url);
}

module.exports = {
  generateOppId,
  getOpportunity,
  getAllOpportunities,
  getOpenOpportunities,
  getPendingPitches,
  saveOpportunity,
  createOpportunity,
  recordPitch,
  recordResponse,
  closeOpportunity,
  isDuplicate,
};
