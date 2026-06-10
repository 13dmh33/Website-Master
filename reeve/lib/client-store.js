'use strict';

// client-store.js — client profile CRUD for Reeve
// Clients live in output/clients/{clientId}.json
// Created when Dave onboards a new client (scripts/onboard-client.js)
// Read by all Phase 2+ agents (conference-scout, pitcher, follower, reporter)

const fs   = require('fs');
const path = require('path');

const CLIENTS_DIR = path.join(__dirname, '..', 'output', 'clients');

if (!fs.existsSync(CLIENTS_DIR)) {
  fs.mkdirSync(CLIENTS_DIR, { recursive: true });
}

function clientPath(clientId) {
  return path.join(CLIENTS_DIR, `${clientId}.json`);
}

function generateClientId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `client-${ts}-${rand}`;
}

// ── Read ──────────────────────────────────────────────────────────────────────

function getClient(clientId) {
  const p = clientPath(clientId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[client-store] Failed to read ${clientId}:`, err.message);
    return null;
  }
}

function getAllClients() {
  try {
    return fs.readdirSync(CLIENTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.error('[client-store] Failed to read clients dir:', err.message);
    return [];
  }
}

function getActiveClients() {
  return getAllClients().filter(c => c.status === 'active');
}

// ── Write ─────────────────────────────────────────────────────────────────────

function saveClient(client) {
  if (!client.id) throw new Error('client.id is required');
  const toWrite = Object.assign({}, client, {
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(clientPath(client.id), JSON.stringify(toWrite, null, 2), 'utf8');
  return toWrite;
}

// Create a new client from onboarding data.
// Returns the saved client object with a generated ID and timestamps.
function createClient(data) {
  const now = new Date().toISOString();
  const client = {
    id:               generateClientId(),
    name:             data.name             || '',
    email:            data.email            || '',
    phone:            data.phone            || null,
    instagramHandle:  data.instagramHandle  || null,
    dmSenderId:       data.dmSenderId       || null,   // Meta sender ID from DM qualifier
    talkTitle:        data.talkTitle        || '',
    talkDurations:    data.talkDurations    || [45],   // array of available lengths in minutes
    bio:              data.bio              || '',
    topics:           data.topics           || [],     // e.g. ["women in tech", "leadership"]
    fee: {
      min: data.fee?.min || null,
      max: data.fee?.max || null,
    },
    retainerTier:     data.retainerTier     || 'starter',  // starter | full
    status:           'active',
    leadSource:       data.leadSource       || 'instagram_dm',
    qualScore:        data.qualScore        || null,   // high | mid | low from DM qualifier
    notes:            data.notes            || '',
    createdAt:        now,
    updatedAt:        now,
  };
  return saveClient(client);
}

function updateClient(clientId, updates) {
  const existing = getClient(clientId);
  if (!existing) throw new Error(`Client not found: ${clientId}`);
  return saveClient(Object.assign({}, existing, updates));
}

function deactivateClient(clientId, reason = '') {
  return updateClient(clientId, { status: 'inactive', deactivatedReason: reason });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getClientCount() {
  return getAllClients().length;
}

function getActiveClientCount() {
  return getActiveClients().length;
}

module.exports = {
  generateClientId,
  getClient,
  getAllClients,
  getActiveClients,
  saveClient,
  createClient,
  updateClient,
  deactivateClient,
  getClientCount,
  getActiveClientCount,
};
