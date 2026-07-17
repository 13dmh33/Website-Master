/**
 * Nora conversation state — one JSON file per conversation, additive-only.
 *
 * Deliberately NOT stored in root state.json: that file's `queue` is keyed
 * by Trevo's own lead_id (Dave's sales prospects) and feeds sheet-log.js's
 * Google Sheets sync. A contractor's end-customer conversations with their
 * deployed Nora agent are a different entity — mixing the two would corrupt
 * that pipeline. See DISCOVERY.md.
 *
 * New fields only get added going forward; existing fields are never
 * renamed, removed, or repurposed once written.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONVERSATIONS_DIR = path.join(__dirname, '..', 'state', 'conversations');

function conversationPath(customerId, conversationId) {
  return path.join(CONVERSATIONS_DIR, customerId, `${conversationId}.json`);
}

function defaultConversation(customerId, conversationId) {
  const now = new Date().toISOString();
  return {
    customerId,
    conversationId,
    channel: null,           // which adapter the message arrived on
    offeringId: null,        // resolved offering, or null until routing resolves
    routingResolved: false,  // boolean
    qualifyIndex: 0,         // index into the resolved offering's qualifyQs
    answers: [],             // [{ question, answer, at }]
    status: 'open',          // open | qualified | booked | escalated
    escalated: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Reads a conversation record, creating a fresh default one if none exists yet. */
function getConversation(customerId, conversationId) {
  const filePath = conversationPath(customerId, conversationId);
  if (!fs.existsSync(filePath)) {
    return defaultConversation(customerId, conversationId);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/** Writes a conversation record. Merges onto any existing file — never drops fields silently. */
function saveConversation(conversation) {
  const { customerId, conversationId } = conversation;
  if (!customerId || !conversationId) {
    throw new Error('saveConversation requires customerId and conversationId on the record');
  }
  const filePath = conversationPath(customerId, conversationId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let existing = {};
  if (fs.existsSync(filePath)) {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  const merged = { ...existing, ...conversation, updatedAt: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = { getConversation, saveConversation, conversationPath, CONVERSATIONS_DIR };
