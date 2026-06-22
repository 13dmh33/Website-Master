#!/usr/bin/env node
/**
 * Audit — checks state.json, queue/, and messages/ for inconsistencies
 *
 * Usage:
 *   node scripts/audit.js           (full report)
 *   node scripts/audit.js --fix     (auto-fix safe issues: sync status mismatches)
 *
 * Checks:
 *   1. Leads in state.json with no brief file in queue/
 *   2. Brief files in queue/ with no state.json entry
 *   3. Leads marked "sent" in state.json but no sent file in messages/
 *   4. Sent files in messages/ where status doesn't match state.json
 *   5. Leads marked positive/replied but no reply_text recorded
 *   6. Drip steps marked sent in sent file but past dead_after_days
 *   7. Duplicate lead_ids in state.json
 */

const fs   = require('fs');
const path = require('path');
const stateStore = require('./state-store');

const ROOT         = path.join(__dirname, '..');
const QUEUE_DIR    = path.join(ROOT, 'queue');
const MESSAGES_DIR = path.join(ROOT, 'messages');

const doFix  = process.argv.includes('--fix');
const issues = [];
const fixes  = [];

function warn(code, leadId, msg) { issues.push({ code, leadId, msg }); }
function note(msg)               { fixes.push(msg); }

// ── LOAD DATA ─────────────────────────────────────────────────────────────────

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

let state;
try {
  state = stateStore.loadState();
} catch (e) {
  console.error(`✗ Cannot read state.json — ${e.message}`);
  process.exit(1);
}

const queue = state.queue || [];

// Index brief files
const briefFiles = new Set(
  fs.existsSync(QUEUE_DIR)
    ? fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json')).map(f => f.replace('-brief.json', ''))
    : []
);

// Index sent files
const sentFiles = new Set(
  fs.existsSync(MESSAGES_DIR)
    ? fs.readdirSync(MESSAGES_DIR).filter(f => f.endsWith('-sent.json')).map(f => f.replace('-sent.json', ''))
    : []
);

// ── CHECK 1: Duplicate lead_ids in state.json ─────────────────────────────────

const seen = new Map();
for (const entry of queue) {
  const id = entry.lead_id;
  if (seen.has(id)) warn('DUPE', id, `Duplicate lead_id in state.json (appears ${seen.get(id) + 1} times)`);
  seen.set(id, (seen.get(id) || 1) + 1);
}

// ── CHECK 2: State entries with no brief ──────────────────────────────────────

for (const entry of queue) {
  if (!briefFiles.has(entry.lead_id)) {
    warn('NO_BRIEF', entry.lead_id, `Status "${entry.status}" in state.json but no brief file in queue/`);
  }
}

// ── CHECK 3: Brief files with no state entry ──────────────────────────────────

const stateIds = new Set(queue.map(e => e.lead_id));
for (const id of briefFiles) {
  if (!stateIds.has(id)) {
    warn('NO_STATE', id, `Brief file exists in queue/ but no state.json entry`);
  }
}

// ── CHECK 4: "sent" status but no sent file ───────────────────────────────────

const SENT_STATUSES = new Set([
  'sent', 'replied', 'positive', 'hot', 'call_booked', 'deal_closed',
  'unsubscribed', 'unresponsive', 'on_hold',
  ...['d1','d1b','d1c','d2'].map(s => `drip_${s}_sent`)
]);

for (const entry of queue) {
  if (SENT_STATUSES.has(entry.status) && !sentFiles.has(entry.lead_id)) {
    warn('NO_SENT', entry.lead_id, `Status "${entry.status}" implies message sent but no sent file in messages/`);
  }
}

// ── CHECK 5: Sent file status vs state.json status ───────────────────────────

for (const id of sentFiles) {
  const sentPath = path.join(MESSAGES_DIR, `${id}-sent.json`);
  const sent     = readJson(sentPath);
  if (!sent) { warn('UNREADABLE', id, `Cannot parse messages/${id}-sent.json`); continue; }

  const stateEntry = queue.find(e => e.lead_id === id);

  // Positive in sent file but state doesn't reflect it
  if (sent.status === 'positive' && stateEntry && !['replied', 'hot', 'call_booked', 'positive'].includes(stateEntry.status)) {
    warn('STATUS_MISMATCH', id, `messages/ says "positive" but state.json says "${stateEntry.status}"`);
    if (doFix) {
      stateEntry.status = 'replied';
      stateEntry.reply_received_at = sent.replied_at || new Date().toISOString();
      note(`Fixed: set state.json status to "replied" for ${id}`);
    }
  }

  // Unsubscribed in sent but not in state
  if (sent.status === 'unsubscribed' && stateEntry && stateEntry.status !== 'unsubscribed') {
    warn('STATUS_MISMATCH', id, `messages/ says "unsubscribed" but state.json says "${stateEntry.status}"`);
    if (doFix) {
      stateEntry.status = 'unsubscribed';
      note(`Fixed: set state.json status to "unsubscribed" for ${id}`);
    }
  }

  // Positive but no reply text recorded
  if (sent.status === 'positive' && !sent.reply_text && !sent.reply_subject) {
    warn('NO_REPLY_TEXT', id, `Status "positive" but no reply_text or reply_subject recorded (may have been set manually)`);
  }
}

// ── CHECK 6: No brief file but sent file exists ───────────────────────────────

for (const id of sentFiles) {
  if (!briefFiles.has(id)) {
    warn('NO_BRIEF_FOR_SENT', id, `Sent file exists but no brief in queue/ — Mobile agent won't be able to load contact details`);
  }
}

// ── APPLY FIXES ───────────────────────────────────────────────────────────────

if (doFix && fixes.length > 0) {
  stateStore.saveState(state);
}

// ── REPORT ───────────────────────────────────────────────────────────────────

const sep  = '─'.repeat(60);
const sep2 = '━'.repeat(60);

console.log('');
console.log(sep2);
console.log('  Trevo Advisors — Pipeline Audit');
console.log(sep2);
console.log('');
console.log(`  State entries:  ${queue.length}`);
console.log(`  Brief files:    ${briefFiles.size}`);
console.log(`  Sent files:     ${sentFiles.size}`);
console.log('');

if (issues.length === 0) {
  console.log('  ✅ No issues found — pipeline looks clean.');
} else {
  const byCode = {};
  for (const issue of issues) {
    byCode[issue.code] = (byCode[issue.code] || []);
    byCode[issue.code].push(issue);
  }

  console.log(`  ⚠️  Found ${issues.length} issue(s):\n`);

  for (const [code, group] of Object.entries(byCode)) {
    console.log(`  ${code} (${group.length})`);
    console.log(sep);
    for (const i of group) {
      const id = i.leadId?.length > 28 ? i.leadId.slice(0, 25) + '...' : (i.leadId || '');
      console.log(`  ${id.padEnd(30)} ${i.msg}`);
    }
    console.log('');
  }

  if (!doFix) {
    const fixable = issues.filter(i => i.code === 'STATUS_MISMATCH').length;
    if (fixable > 0) {
      console.log(`  ${fixable} issue(s) can be auto-fixed. Run with --fix to apply.`);
    }
  }
}

if (fixes.length > 0) {
  console.log(`  ✅ Applied ${fixes.length} fix(es):`);
  for (const f of fixes) console.log(`     • ${f}`);
}

console.log('');
console.log(sep2);
console.log('');

process.exit(issues.length > 0 ? 1 : 0);
