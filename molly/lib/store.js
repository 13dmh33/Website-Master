'use strict';

// abstraction layer for all Molly data persistence
// currently uses local JSON files — swap Airtable in later by replacing internals only
// agents never need to change when the backend changes

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PATHS = {
  briefs:     path.join(ROOT, 'output', 'briefs'),
  content:    path.join(ROOT, 'output', 'content'),
  images:     path.join(ROOT, 'output', 'images'),
  queue:      path.join(ROOT, 'output', 'queue'),
  archive:    path.join(ROOT, 'output', 'archive'),
  brandVoice:  path.join(ROOT, 'templates', 'brand-voice.json'),
  postFormats: path.join(ROOT, 'templates', 'post-formats.json'),
  // Quarantined 2026-07-18 — violates molly/CLAUDE.md's brand-voice rules
  // throughout (unsourced stats, hard delivery promises, unconsented client
  // results, city references). Kept readable here only so nothing that reads
  // it crashes; brand-validator.js is the hard gate that stops any of this
  // content from reaching the posting path. See molly/quarantine/README.md.
  evergreen:   path.join(ROOT, 'quarantine', 'evergreen-prespec.json'),
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Store: failed to read ${filePath} — ${err.message}`);
    return null;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function dateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

module.exports = {

  savePost(postData) {
    const weekOf   = postData.weekOf || dateKey();
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    writeJson(filePath, postData);
    return filePath;
  },

  getPostsForWeek(weekOf) {
    return readJson(path.join(PATHS.content, `content-${weekOf}.json`));
  },

  getLatestContent() {
    ensureDir(PATHS.content);
    const files = fs.readdirSync(PATHS.content)
      .filter(f => f.startsWith('content-') && f.endsWith('.json'))
      .sort().reverse();
    if (!files.length) return null;
    return readJson(path.join(PATHS.content, files[0]));
  },

  updatePostStatus(weekOf, format, status) {
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    const data     = readJson(filePath);
    if (!data) return;
    if (!data.status) data.status = {};
    data.status[format] = { status, updatedAt: new Date().toISOString() };
    writeJson(filePath, data);
  },

  saveBrief(brief) {
    const weekOf   = brief.weekOf || dateKey();
    const filePath = path.join(PATHS.briefs, `brief-${weekOf}.json`);
    writeJson(filePath, brief);
    return filePath;
  },

  getLatestBrief() {
    ensureDir(PATHS.briefs);
    const files = fs.readdirSync(PATHS.briefs)
      .filter(f => f.startsWith('brief-') && f.endsWith('.json'))
      .sort().reverse();
    if (!files.length) return null;
    return readJson(path.join(PATHS.briefs, files[0]));
  },

  saveAnalytics(metrics) {
    const weekOf   = metrics.weekOf || dateKey();
    const filePath = path.join(PATHS.archive, `analytics-${weekOf}.json`);
    writeJson(filePath, metrics);
    return filePath;
  },

  getRecentAnalytics(weeks = 8) {
    ensureDir(PATHS.archive);
    const files = fs.readdirSync(PATHS.archive)
      .filter(f => f.startsWith('analytics-') && f.endsWith('.json'))
      .sort().reverse().slice(0, weeks);
    return files.map(f => readJson(path.join(PATHS.archive, f))).filter(Boolean);
  },

  getBrandVoice() {
    return readJson(PATHS.brandVoice);
  },

  updateBrandVoice(updates) {
    const current = readJson(PATHS.brandVoice) || {};
    const merged  = { ...current, ...updates, last_updated: new Date().toISOString() };
    if (merged.what_works && merged.what_works.length > 8)
      merged.what_works = merged.what_works.slice(-8);
    if (merged.top_hashtags && merged.top_hashtags.length > 8)
      merged.top_hashtags = merged.top_hashtags.slice(-8);
    writeJson(PATHS.brandVoice, merged);
  },

  getPostFormats() {
    return readJson(PATHS.postFormats);
  },

  advanceWeekRotation() {
    const data = readJson(PATHS.postFormats);
    if (!data) return;
    const len = data.weekly_rotation.caption_niche_alternation.length || 3;
    data.weekly_rotation.current_week = (data.weekly_rotation.current_week + 1) % len;
    writeJson(PATHS.postFormats, data);
  },

  getWeekNiches() {
    const data = readJson(PATHS.postFormats);
    if (!data) return { caption: 'education', reel: 'results', weekNumber: 0 };
    const idx    = data.weekly_rotation.current_week || 0;
    const reelLen = data.weekly_rotation.reel_niche_alternation.length || 2;
    return {
      caption:    data.weekly_rotation.caption_niche_alternation[idx],
      reel:       data.weekly_rotation.reel_niche_alternation[idx % reelLen],
      weekNumber: idx,
    };
  },

  getEvergreen() {
    return readJson(PATHS.evergreen);
  },

  saveEvergreen(data) {
    writeJson(PATHS.evergreen, data);
  },

  getUnusedEvergreen(count = 4) {
    const data = readJson(PATHS.evergreen);
    if (!data || !data.posts) return [];
    const unused = data.posts.filter(p => !p.used).slice(0, count);
    if (unused.length < count) {
      const used = data.posts
        .filter(p => p.used)
        .sort((a, b) => new Date(a.lastUsed || 0) - new Date(b.lastUsed || 0));
      return [...unused, ...used].slice(0, count);
    }
    return unused;
  },

  markEvergreenUsed(ids) {
    const data = readJson(PATHS.evergreen);
    if (!data || !data.posts) return;
    const now  = new Date().toISOString();
    data.posts = data.posts.map(p =>
      ids.includes(p.id) ? { ...p, used: true, lastUsed: now } : p
    );
    writeJson(PATHS.evergreen, data);
  },

  saveToQueue(post) {
    const filename = `${post.scheduledFor.split('T')[0]}-${post.format}.json`;
    const filePath = path.join(PATHS.queue, filename);
    writeJson(filePath, post);
    return filePath;
  },

  getPendingQueue() {
    ensureDir(PATHS.queue);
    const files = fs.readdirSync(PATHS.queue)
      .filter(f => f.endsWith('.json') && !f.startsWith('preview-'))
      .sort();
    return files
      .map(f => ({ file: f, ...readJson(path.join(PATHS.queue, f)) }))
      .filter(p => p.status === 'pending');
  },

  markQueuePosted(filename) {
    const filePath = path.join(PATHS.queue, filename);
    const data     = readJson(filePath);
    if (!data) return;
    data.status   = 'posted';
    data.postedAt = new Date().toISOString();
    writeJson(filePath, data);
  },

  paths: PATHS,
  dateKey,
  ensureDir,
};
