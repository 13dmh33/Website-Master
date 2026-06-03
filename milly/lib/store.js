'use strict';

// abstraction layer for all data persistence
// currently uses local JSON files
// swap Airtable in later by replacing the internals of these functions only
// agents never need to change when the backend changes

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATHS = {
  briefs:    path.join(ROOT, 'output', 'briefs'),
  content:   path.join(ROOT, 'output', 'content'),
  images:    path.join(ROOT, 'output', 'images'),
  queue:     path.join(ROOT, 'output', 'queue'),
  archive:   path.join(ROOT, 'output', 'archive'),
  brandVoice:   path.join(ROOT, 'templates', 'brand-voice.json'),
  postFormats:  path.join(ROOT, 'templates', 'post-formats.json'),
  evergreen:    path.join(ROOT, 'templates', 'evergreen.json'),
  inspiration:  path.join(ROOT, 'templates', 'inspiration-sources.json'),
};

// ensure a directory exists before writing to it
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// read a JSON file safely — returns null if file doesn't exist
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Store: failed to read ${filePath} — ${err.message}`);
    return null;
  }
}

// write a JSON file safely
function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// generate a consistent ISO date string for file naming
function dateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

module.exports = {

  // ─── content calendar ─────────────────────────────────────────────────────

  // save a generated content batch for a given week
  savePost(postData) {
    const weekOf = postData.weekOf || dateKey();
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    writeJson(filePath, postData);
    return filePath;
  },

  // read content for a given week (weekOf = 'YYYY-MM-DD')
  getPostsForWeek(weekOf) {
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    return readJson(filePath);
  },

  // read the most recently generated content batch
  getLatestContent() {
    ensureDir(PATHS.content);
    const files = fs.readdirSync(PATHS.content)
      .filter(f => f.startsWith('content-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (!files.length) return null;
    return readJson(path.join(PATHS.content, files[0]));
  },

  // update post status — pending | scheduled | posted | failed
  updatePostStatus(weekOf, format, status) {
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    const data = readJson(filePath);
    if (!data) return;
    if (!data.status) data.status = {};
    data.status[format] = { status, updatedAt: new Date().toISOString() };
    writeJson(filePath, data);
  },

  // ─── research briefs ──────────────────────────────────────────────────────

  // save a weekly research brief
  saveBrief(brief) {
    const weekOf = brief.weekOf || dateKey();
    const filePath = path.join(PATHS.briefs, `brief-${weekOf}.json`);
    writeJson(filePath, brief);
    return filePath;
  },

  // read the most recent research brief
  getLatestBrief() {
    ensureDir(PATHS.briefs);
    const files = fs.readdirSync(PATHS.briefs)
      .filter(f => f.startsWith('brief-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (!files.length) return null;
    return readJson(path.join(PATHS.briefs, files[0]));
  },

  // ─── analytics ────────────────────────────────────────────────────────────

  // save weekly analytics snapshot
  saveAnalytics(metrics) {
    const weekOf = metrics.weekOf || dateKey();
    const filePath = path.join(PATHS.archive, `analytics-${weekOf}.json`);
    writeJson(filePath, metrics);
    return filePath;
  },

  // read analytics from the last N weeks
  getRecentAnalytics(weeks = 8) {
    ensureDir(PATHS.archive);
    const files = fs.readdirSync(PATHS.archive)
      .filter(f => f.startsWith('analytics-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, weeks);
    return files.map(f => readJson(path.join(PATHS.archive, f))).filter(Boolean);
  },

  // ─── brand voice ──────────────────────────────────────────────────────────

  // read inspiration sources — themes only, never copy content directly
  getInspirationSources() {
    return readJson(PATHS.inspiration);
  },

  // read the brand voice config
  getBrandVoice() {
    return readJson(PATHS.brandVoice);
  },

  // update brand voice — typically called by analyst after weekly review
  updateBrandVoice(updates) {
    const current = readJson(PATHS.brandVoice) || {};
    const merged = { ...current, ...updates, last_updated: new Date().toISOString() };

    // keep what_works rolling to last 8 entries
    if (merged.what_works && merged.what_works.length > 8) {
      merged.what_works = merged.what_works.slice(-8);
    }

    // keep top_hashtags rolling to last 8 entries
    if (merged.top_hashtags && merged.top_hashtags.length > 8) {
      merged.top_hashtags = merged.top_hashtags.slice(-8);
    }

    writeJson(PATHS.brandVoice, merged);
  },

  // ─── post formats ─────────────────────────────────────────────────────────

  // read format specs and weekly rotation state
  getPostFormats() {
    return readJson(PATHS.postFormats);
  },

  // advance the weekly alternation counter — mods by caption array length
  // so adding more niches to caption_niche_alternation just works
  advanceWeekRotation() {
    const data = readJson(PATHS.postFormats);
    if (!data) return;
    const len = data.weekly_rotation.caption_niche_alternation.length || 2;
    data.weekly_rotation.current_week = (data.weekly_rotation.current_week + 1) % len;
    writeJson(PATHS.postFormats, data);
  },

  // get which niche to use for caption and reel this week
  getWeekNiches() {
    const data = readJson(PATHS.postFormats);
    if (!data) return { caption: 'mindset', reel: 'automation', weekNumber: 0 };
    const idx = data.weekly_rotation.current_week || 0;
    const reelLen = data.weekly_rotation.reel_niche_alternation.length || 2;
    return {
      caption:    data.weekly_rotation.caption_niche_alternation[idx],
      reel:       data.weekly_rotation.reel_niche_alternation[idx % reelLen],
      weekNumber: idx,
    };
  },

  // ─── evergreen ────────────────────────────────────────────────────────────

  // read the full evergreen bank
  getEvergreen() {
    return readJson(PATHS.evergreen);
  },

  // save the evergreen bank (used by generate-evergreen.js)
  saveEvergreen(data) {
    writeJson(PATHS.evergreen, data);
  },

  // get up to N unused (or least recently used) evergreen posts
  getUnusedEvergreen(count = 4) {
    const data = readJson(PATHS.evergreen);
    if (!data || !data.posts) return [];

    const unused = data.posts
      .filter(p => !p.used)
      .slice(0, count);

    // if not enough unused, fall back to least recently used
    if (unused.length < count) {
      const used = data.posts
        .filter(p => p.used)
        .sort((a, b) => new Date(a.lastUsed || 0) - new Date(b.lastUsed || 0));
      return [...unused, ...used].slice(0, count);
    }

    return unused;
  },

  // mark evergreen posts as used
  markEvergreenUsed(ids) {
    const data = readJson(PATHS.evergreen);
    if (!data || !data.posts) return;
    const now = new Date().toISOString();
    data.posts = data.posts.map(p =>
      ids.includes(p.id) ? { ...p, used: true, lastUsed: now } : p
    );
    writeJson(PATHS.evergreen, data);
  },

  // ─── queue ────────────────────────────────────────────────────────────────

  // save a post to the manual queue
  saveToQueue(post) {
    const filename = `${post.scheduledFor.split('T')[0]}-${post.format}.json`;
    const filePath = path.join(PATHS.queue, filename);
    writeJson(filePath, post);
    return filePath;
  },

  // read all pending queue items
  getPendingQueue() {
    ensureDir(PATHS.queue);
    const files = fs.readdirSync(PATHS.queue)
      .filter(f => f.endsWith('.json') && !f.startsWith('preview-'))
      .sort();
    return files
      .map(f => ({ file: f, ...readJson(path.join(PATHS.queue, f)) }))
      .filter(p => p.status === 'pending');
  },

  // mark a queue item as posted
  markQueuePosted(filename) {
    const filePath = path.join(PATHS.queue, filename);
    const data = readJson(filePath);
    if (!data) return;
    data.status = 'posted';
    data.postedAt = new Date().toISOString();
    writeJson(filePath, data);
  },

  // expose path helpers for agents that need to write images etc.
  paths: PATHS,
  dateKey,
  ensureDir,
};
