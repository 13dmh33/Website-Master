'use strict';

// reels-state.js — all reads/writes of the REELS lane go through here.
//
// Reels live in the SAME tatas/state.json as the carousel lane, but in a
// separate top-level `reels` array — NOT mixed into `posts`. Phase 1's
// lib/state.js only ever touches `data.posts` (and round-trips every other
// key untouched through its whole-object save), so the two lanes can never
// collide: no Phase 1 script sees a reel, no reels script sees a carousel.
// This is why reels items don't need a `scheduledFor` or a carousel status.
//
// Reel lifecycle: pending → approved (+chosenHook) | rejected → voiced
//                 (briefer stamps briefedAt; does not change status)

const fs   = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

function load() {
  const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!Array.isArray(data.posts)) data.posts = []; // preserve Phase 1 shape
  if (!Array.isArray(data.reels)) data.reels = [];
  return data;
}

function save(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// append new reels (never replaces existing ones; leaves posts[] untouched)
function addReels(newReels) {
  const state = load();
  state.reels.push(...newReels);
  state.last_reels_writer_run = new Date().toISOString();
  save(state);
  return state;
}

// merge fields into the reel with the given id (additive update)
function updateReel(id, fields) {
  const state = load();
  const reel  = state.reels.find(r => r.id === id);
  if (!reel) throw new Error(`No reel with id ${id} in tatas/state.json`);
  Object.assign(reel, fields);
  save(state);
  return reel;
}

function latestWeek(state = load()) {
  const weeks = [...new Set(state.reels.map(r => r.weekOf))].sort();
  return weeks.length ? weeks[weeks.length - 1] : null;
}

module.exports = { STATE_PATH, load, save, addReels, updateReel, latestWeek };
