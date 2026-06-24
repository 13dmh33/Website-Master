'use strict';

// abstraction layer for all data persistence (Miley — Techs4Tatas engine)
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
  leads:     path.join(ROOT, 'output', 'leads'),
  clicks:    path.join(ROOT, 'output', 'clicks'),
  linkpage:  path.join(ROOT, 'linkpage'),
  assets:        path.join(ROOT, 'assets'),
  brandVoice:    path.join(ROOT, 'templates', 'brand-voice.json'),
  postFormats:   path.join(ROOT, 'templates', 'post-formats.json'),
  evergreen:     path.join(ROOT, 'templates', 'evergreen.json'),
  inspiration:   path.join(ROOT, 'templates', 'inspiration-sources.json'),
  glossary:      path.join(ROOT, 'templates', 'trades-glossary.json'),
  hashtagMaster: path.join(ROOT, 'templates', 'hashtag-master.json'),
  october:       path.join(ROOT, 'templates', 'october-campaign.json'),
  visualConfig:  path.join(ROOT, 'templates', 'visual-config.json'),
  calendar:      path.join(ROOT, 'templates', 'calendar.json'),
  topPerformers: path.join(ROOT, 'templates', 'top-performers.json'),
  comments:      path.join(ROOT, 'output', 'comments'),
  productWeights:path.join(ROOT, 'output', 'product-weights.json'),
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

  getPostsForWeek(weekOf) {
    return readJson(path.join(PATHS.content, `content-${weekOf}.json`));
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

  // update a single post's status — pending | scheduled | posted | failed
  updatePostStatus(weekOf, slot, status) {
    const filePath = path.join(PATHS.content, `content-${weekOf}.json`);
    const data = readJson(filePath);
    if (!data) return;
    if (!data.status) data.status = {};
    data.status[slot] = { status, updatedAt: new Date().toISOString() };
    writeJson(filePath, data);
  },

  // ─── research briefs ──────────────────────────────────────────────────────

  saveBrief(brief) {
    const weekOf = brief.weekOf || dateKey();
    const filePath = path.join(PATHS.briefs, `brief-${weekOf}.json`);
    writeJson(filePath, brief);
    return filePath;
  },

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

  saveAnalytics(metrics) {
    const weekOf = metrics.weekOf || dateKey();
    const filePath = path.join(PATHS.archive, `analytics-${weekOf}.json`);
    writeJson(filePath, metrics);
    return filePath;
  },

  getRecentAnalytics(weeks = 8) {
    ensureDir(PATHS.archive);
    const files = fs.readdirSync(PATHS.archive)
      .filter(f => f.startsWith('analytics-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, weeks);
    return files.map(f => readJson(path.join(PATHS.archive, f))).filter(Boolean);
  },

  // ─── brand voice + config ─────────────────────────────────────────────────

  getInspirationSources() { return readJson(PATHS.inspiration); },
  getBrandVoice()         { return readJson(PATHS.brandVoice); },
  getHashtagMaster()      { return readJson(PATHS.hashtagMaster); },
  getOctoberCampaign()    { return readJson(PATHS.october); },
  getVisualConfig()       { return readJson(PATHS.visualConfig); },
  getCalendar()           { return readJson(PATHS.calendar); },

  // ─── top performers (self-critique loop, #2) ───────────────────────────────
  // { byType: { <contentType>: [ {caption, engagementRate, weekOf}, ... up to 5 ] } }
  getTopPerformers() { return readJson(PATHS.topPerformers) || { byType: {} }; },
  saveTopPerformers(data) { writeJson(PATHS.topPerformers, data); },

  // ─── comments / DM sentiment ingestion (#8) ────────────────────────────────
  // Drop a JSON file at output/comments/latest.json shaped like:
  //   { "weekOf": "...", "comments": [ { "text": "...", "postId": "..." }, ... ] }
  getComments() {
    const latest = path.join(PATHS.comments, 'latest.json');
    return readJson(latest);
  },

  // ─── product-rotation weights (#9) ─────────────────────────────────────────
  getProductWeights() { return readJson(PATHS.productWeights); },
  saveProductWeights(data) { writeJson(PATHS.productWeights, data); },

  // update brand voice — typically called by analyst after weekly review
  // NOTE: what_works and top_hashtags are analyst-owned (auto-filled). Do not hand-edit.
  updateBrandVoice(updates) {
    const current = readJson(PATHS.brandVoice) || {};
    const merged = { ...current, ...updates, last_updated: new Date().toISOString() };
    if (merged.what_works && merged.what_works.length > 8)   merged.what_works = merged.what_works.slice(-8);
    if (merged.top_hashtags && merged.top_hashtags.length > 8) merged.top_hashtags = merged.top_hashtags.slice(-8);
    writeJson(PATHS.brandVoice, merged);
  },

  // ─── post formats + rotation ───────────────────────────────────────────────

  getPostFormats()  { return readJson(PATHS.postFormats); },

  // single incrementing week counter (post-formats.json `current_week`)
  getCurrentWeek() {
    const data = readJson(PATHS.postFormats);
    return (data && typeof data.current_week === 'number') ? data.current_week : 0;
  },

  // advance the week counter by one (called once per pipeline run)
  advanceWeek() {
    const data = readJson(PATHS.postFormats);
    if (!data) return;
    data.current_week = ((data.current_week || 0) + 1);
    writeJson(PATHS.postFormats, data);
  },

  // the 8-item product catalog rotation
  getProductCatalog() {
    const data = readJson(PATHS.postFormats);
    return (data && data.product_catalog_rotation) || [];
  },

  getContentPools() {
    const data = readJson(PATHS.postFormats);
    return (data && data.content_pools) || {};
  },

  // ─── evergreen ────────────────────────────────────────────────────────────

  getEvergreen()        { return readJson(PATHS.evergreen); },
  saveEvergreen(data)   { writeJson(PATHS.evergreen, data); },

  // get the next unused evergreen post of a given type (mission/product_feature/etc.)
  // falls back to least-recently-used of that type, then any unused, then anything
  getUnusedEvergreenByType(type, excludeIds = []) {
    const data = readJson(PATHS.evergreen);
    if (!data || !data.posts) return null;
    const ofType = data.posts.filter(p => p.type === type && !excludeIds.includes(p.id));

    const pickFrom = ofType.length ? ofType : data.posts.filter(p => !excludeIds.includes(p.id));
    if (!pickFrom.length) return null;

    const unused = pickFrom.filter(p => !p.used);
    if (unused.length) return unused[0];

    // all used — pick least recently used
    return [...pickFrom].sort((a, b) => new Date(a.lastUsed || 0) - new Date(b.lastUsed || 0))[0];
  },

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

  saveToQueue(post) {
    const day = (post.scheduledFor || new Date().toISOString()).split('T')[0];
    const filename = `${day}-${post.slot || post.format}.json`;
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
    const data = readJson(filePath);
    if (!data) return;
    data.status = 'posted';
    data.postedAt = new Date().toISOString();
    writeJson(filePath, data);
  },

  // ─── leads (email capture from DMs) ─────────────────────────────────────────

  // append a captured lead (dedup by email) → output/leads/leads.json
  saveLead(lead) {
    ensureDir(PATHS.leads);
    const filePath = path.join(PATHS.leads, 'leads.json');
    const data = readJson(filePath) || { leads: [] };
    const email = (lead.email || '').toLowerCase();
    if (email && data.leads.some(l => l.email === email)) return false; // already have them
    data.leads.push({ ...lead, email, capturedAt: new Date().toISOString() });
    writeJson(filePath, data);
    return true;
  },

  getLeads() {
    return readJson(path.join(PATHS.leads, 'leads.json')) || { leads: [] };
  },

  // ─── click data (UTM attribution, exported from GA4 / Pixel / ManyChat) ─────
  // Drop a JSON file at output/clicks/latest.json shaped like:
  //   { "weekOf": "...", "linkpage_views": 123, "by_content": { "snapback_hat": 14, ... } }
  // The Analyst joins by_content to posts via each post's utm_content (product).
  getClickData() {
    const latest = path.join(PATHS.clicks, 'latest.json');
    if (fs.existsSync(latest)) return readJson(latest);
    ensureDir(PATHS.clicks);
    const files = fs.readdirSync(PATHS.clicks)
      .filter(f => f.startsWith('clicks-') && f.endsWith('.json'))
      .sort()
      .reverse();
    return files.length ? readJson(path.join(PATHS.clicks, files[0])) : null;
  },

  // expose path helpers for agents that need to write images etc.
  paths: PATHS,
  dateKey,
  ensureDir,
};
