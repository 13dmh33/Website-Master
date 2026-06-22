'use strict';

/**
 * Template picker — selects, fills, and tracks outreach templates.
 *
 * Selection strategy:
 *   Phase 1: round-robin until every auto template has MIN_SENDS sends
 *   Phase 2: epsilon-greedy (EPSILON random explore, rest exploit best reply rate)
 *
 * Exports:
 *   pickAndFill(channel, lead)   → { template_id, template_name, message, subject } | null
 *   recordSent(channel, id)      → increments send count
 *   recordReply(channel, id)     → increments reply count
 *   printStats()                 → logs table to console
 */

const fs   = require('fs');
const path = require('path');

const TEMPLATES_PATH = path.join(__dirname, '..', 'config', 'templates.json');
const STATS_PATH     = path.join(__dirname, '..', 'config', 'template-stats.json');

const EPSILON        = 0.20;
// Bootstrap: every template must get MIN_SENDS sends (round-robin, ignoring
// reply rate) before epsilon-greedy selection kicks in. This guarantees each
// template has enough data to produce a meaningful reply rate before it can
// be starved by the exploit phase.
const MIN_SENDS      = 3;

// Tone hints — steers explore/bootstrap toward tone-matched templates
const TONE_MAP = {
  email: { warm: ['e1', 'e5'], direct: ['e2', 'e3', 'e4'], urgent: ['e2', 'e4'], professional: ['e1', 'e3'] },
  sms:   { warm: ['s1'],       direct: ['s2', 's3', 's4'], urgent: ['s2'],        professional: ['s1', 's3'] },
};

function toneMatches(templateId, channel, tone) {
  if (!tone) return false;
  return (TONE_MAP[channel]?.[tone] || []).includes(templateId);
}

// ── LOAD / SAVE ───────────────────────────────────────────────────────────────

function loadTemplates() {
  return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
}

function loadStats() {
  if (!fs.existsSync(STATS_PATH)) return initStats();
  try { return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); }
  catch { return initStats(); }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

function initStats() {
  const templates = loadTemplates();
  const stats = { email: {}, sms: {} };
  for (const [channel, list] of Object.entries(templates)) {
    if (!Array.isArray(list)) continue;
    for (const t of list) stats[channel][t.id] = { sent: 0, replies: 0 };
  }
  saveStats(stats);
  return stats;
}

// ── SELECTION ─────────────────────────────────────────────────────────────────

function canFill(template, lead) {
  return (template.requires || []).every(field => !!lead[field]);
}

function replyRate(id, channelStats) {
  const s = channelStats[id];
  if (!s || s.sent === 0) return 0;
  return s.replies / s.sent;
}

function selectTemplate(channel, lead) {
  const all   = loadTemplates()[channel] || [];
  const stats = loadStats();
  const cs    = stats[channel] || {};

  const available = all.filter(t => t.type !== 'followup' && canFill(t, lead));
  if (available.length === 0) return null;

  // Prioritise templates below MIN_SENDS threshold (bootstrap phase)
  const underserved = available.filter(t => (cs[t.id]?.sent || 0) < MIN_SENDS);
  if (underserved.length > 0) {
    // Within bootstrap, prefer tone-matched templates first
    const tonePool = underserved.filter(t => toneMatches(t.id, channel, lead.tone));
    const pool = tonePool.length > 0 ? tonePool : underserved;
    return pool.reduce((a, b) =>
      (cs[a.id]?.sent || 0) <= (cs[b.id]?.sent || 0) ? a : b
    );
  }

  // Epsilon-greedy
  if (Math.random() < EPSILON) {
    // Explore: prefer tone-matched templates when available
    const tonePool = available.filter(t => toneMatches(t.id, channel, lead.tone));
    const pool = tonePool.length > 0 ? tonePool : available;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return available.reduce((best, t) =>
    replyRate(t.id, cs) >= replyRate(best.id, cs) ? t : best
  );
}

// ── PLACEHOLDER FILLING ───────────────────────────────────────────────────────

function fill(text, lead) {
  const firstName   = (lead.business_name || '').split(/[\s,]+/)[0] || lead.business_name;
  const phone       = process.env.CONTACT_PHONE || 'trevoadvisors.com';
  const cityDisplay = (lead.city || '').replace(/,\s*[A-Z]{2}$/, '');

  return text
    .replace(/\[First Name\]/g,        firstName)
    .replace(/\[Business Name\]/g,     lead.business_name       || '')
    .replace(/\[City\]/g,              cityDisplay)
    .replace(/\[trade\]/g,             lead.trade               || '')
    .replace(/\[X\]/g,                 String(lead.review_count || ''))
    .replace(/\[Review Count\]/g,      String(lead.review_count || ''))
    .replace(/\[Phone\]/g,             phone)
    .replace(/\[referral_name\]/gi,    lead.referral_name       || '')
    .replace(/\[competitor_name\]/gi,  lead.competitor_name     || '')
    .replace(/\[website_observation\]/gi, lead.website_observation || '');
}

function hasUnfilledPlaceholder(text) {
  // Detect any remaining [Word] patterns (capital letter = unfilled template token)
  return /\[[A-Z]/.test(text);
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

function pickAndFill(channel, lead) {
  const template = selectTemplate(channel, lead);
  if (!template) return null;

  const message = fill(template.body, lead);
  const subject = template.subject ? fill(template.subject, lead) : null;

  if (hasUnfilledPlaceholder(message) || (subject && hasUnfilledPlaceholder(subject))) {
    return null;
  }

  return {
    template_id:   template.id,
    template_name: template.name,
    message,
    subject
  };
}

function recordSent(channel, templateId) {
  if (!channel || !templateId) return;
  const stats = loadStats();
  if (!stats[channel])           stats[channel]            = {};
  if (!stats[channel][templateId]) stats[channel][templateId] = { sent: 0, replies: 0 };
  stats[channel][templateId].sent++;
  saveStats(stats);
}

function recordReply(channel, templateId) {
  if (!channel || !templateId) return;
  const stats = loadStats();
  if (!stats[channel]?.[templateId]) return;
  stats[channel][templateId].replies++;
  saveStats(stats);
}

function printStats() {
  const stats     = loadStats();
  const templates = loadTemplates();
  console.log('\n── Template Performance ─────────────────────────────');
  console.log('  ID   Channel  Name                         Sent  Replies  Rate');
  console.log('  ──   ───────  ────                         ────  ───────  ────');
  for (const [channel, list] of Object.entries(templates)) {
    if (!Array.isArray(list)) continue;
    for (const t of list) {
      const s    = stats[channel]?.[t.id] || { sent: 0, replies: 0 };
      const rate = s.sent > 0 ? ((s.replies / s.sent) * 100).toFixed(1) + '%' : 'n/a';
      const name = t.name.padEnd(28).slice(0, 28);
      console.log(`  ${t.id.padEnd(4)} ${channel.padEnd(7)}  ${name}  ${String(s.sent).padStart(4)}  ${String(s.replies).padStart(7)}  ${rate}`);
    }
  }
  console.log('─'.repeat(52));
}

module.exports = { pickAndFill, recordSent, recordReply, printStats };

// ── CLI ────────────────────────────────────────────────────────────────────
// node scripts/template-picker.js --report
if (require.main === module) {
  if (process.argv.includes('--report')) {
    printStats();
  } else {
    console.log('Usage: node scripts/template-picker.js --report');
  }
}
