'use strict';

// state.js — all reads/writes of tatas/state.json go through here.
// Additive by design: scripts append posts or update fields on existing
// posts; nothing ever drops records. (Convention shared with the Trevo
// root state.json.)
//
// Post lifecycle: pending → approved → posted
//                 (or: skipped · failed [3 attempts] · stale [>72h overdue])

const fs   = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', 'state.json');

function load() {
  const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  if (!Array.isArray(data.posts)) data.posts = [];
  return data;
}

function save(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// append new posts (never replaces existing ones)
function addPosts(newPosts) {
  const state = load();
  state.posts.push(...newPosts);
  state.last_writer_run = new Date().toISOString();
  save(state);
  return state;
}

// merge fields into the post with the given id (additive update)
function updatePost(id, fields) {
  const state = load();
  const post  = state.posts.find(p => p.id === id);
  if (!post) throw new Error(`No post with id ${id} in tatas/state.json`);
  Object.assign(post, fields);
  save(state);
  return post;
}

// newest weekOf present in state (or null)
function latestWeek(state = load()) {
  const weeks = [...new Set(state.posts.map(p => p.weekOf))].sort();
  return weeks.length ? weeks[weeks.length - 1] : null;
}

module.exports = { STATE_PATH, load, save, addPosts, updatePost, latestWeek };
