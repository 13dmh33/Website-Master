#!/usr/bin/env node
/**
 * Builder — generates Lovable.dev prompts for top 5 priority leads
 *
 * Usage:
 *   node scripts/builder.js --force
 *   node scripts/builder.js --submit --lead {lead_id} --url {lovable_url}
 *
 * Reads:  queue/*-brief.json  (priority = true, checker_approved = true)
 *         config/builder-config.json
 * Writes: mockups/{lead_id}-lovable-prompt.txt  (paste into lovable.dev)
 *         mockups/{lead_id}-v1.txt              ("prompt_ready" or Lovable URL after --submit)
 *         state.json
 *         logs/{date}.log
 *
 * Lovable has no public API. Prompts are generated locally and pasted manually.
 * After building in Lovable, use --submit to record the deploy URL.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs   = require('fs');
const path = require('path');
const stateStore = require('./state-store');
const { writeLog } = require('./logger');

// ── PATHS ─────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'builder-config.json');
const STATE_PATH  = path.join(ROOT, 'state.json');
const QUEUE_DIR   = path.join(ROOT, 'queue');
const MOCKUPS_DIR = path.join(ROOT, 'mockups');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const getArg     = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag    = (flag) => args.includes(flag);
const isSubmit   = hasFlag('--submit');
const submitLead = getArg('--lead');
const submitUrl  = getArg('--url');

// ── TRADE COLOR GUIDE ─────────────────────────────────────────────────────────

const TRADE_COLORS = {
  plumber:     { hex: '#1a4f8a', name: 'Navy Blue' },
  hvac:        { hex: '#c0392b', name: 'Red' },
  electrician: { hex: '#f39c12', name: 'Amber' },
  roofer:      { hex: '#7f8c8d', name: 'Slate Grey' },
  handyman:    { hex: '#27ae60', name: 'Green' },
  default:     { hex: '#2E5B8A', name: 'Slate Blue' }  // Trevo brand primary
};

// ── CONFIG ────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      daily_limit: 5,
      auto_run:    false,
      today:       today(),
      built_today: 0,
      total_built: 0,
      last_run:    null
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function checkAutoRun(config) {
  if (hasFlag('--force') || isSubmit) return;
  if (!config.auto_run) {
    console.log('Builder is in manual mode (auto_run = false).');
    console.log('Run with --force to generate prompts, or --submit to record a Lovable URL.');
    process.exit(0);
  }
}

function checkLimits(config) {
  if (config.today !== today()) { config.today = today(); config.built_today = 0; }
  if (config.built_today >= config.daily_limit) {
    console.error(`DAILY LIMIT: ${config.built_today}/${config.daily_limit} mockups already built today.`);
    process.exit(1);
  }
  return config.daily_limit - config.built_today;
}

// ── LOAD PRIORITY BRIEFS ──────────────────────────────────────────────────────

function loadPriorityBriefs(limit) {
  const built = new Set(
    fs.readdirSync(MOCKUPS_DIR)
      .filter(f => f.endsWith('-v1.txt'))
      .map(f => f.replace('-v1.txt', ''))
  );

  const briefs = [];
  for (const file of fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      if (data.priority && data.checker_approved && !built.has(data.lead_id)) {
        briefs.push(data);
      }
    } catch (e) {
      console.warn(`Could not read ${file}: ${e.message}`);
    }
  }

  return briefs.sort((a, b) => (b.gap_score || 0) - (a.gap_score || 0)).slice(0, limit);
}

// ── PROMPT GENERATOR ──────────────────────────────────────────────────────────

function generatePrompt(brief) {
  const color = TRADE_COLORS[brief.trade?.toLowerCase()] || TRADE_COLORS.default;

  return `Build a landing page for ${brief.business_name}, a ${brief.trade} based in ${brief.city}.

Hero angle: ${brief.hero_angle || `Trusted local ${brief.trade} with proven results`}

Sections (in order):
1. HERO: Large headline using the hero angle. Subheadline with service area.
   CTA button: "Get a Free Quote" — links to #contact
2. SERVICES: 3–4 services with icons. Use ${brief.trade}-specific services only.
3. TRUST: Years in business badge, Licensed & Insured badge, service area for ${brief.city} and surrounding areas.
4. REVIEWS: Placeholder for 3 Google reviews (${brief.review_count || 'many'} reviews, ${brief.rating || '4.8'} stars).
5. CONTACT/FOOTER: Phone number ${brief.phone ? `(${brief.phone})` : ''} large and prominent. Simple contact form.

Design rules:
- Mobile-first layout (majority of traffic is phone)
- Clean, trust-focused — NOT trendy or startup-looking
- Primary color: ${color.hex} (${color.name})
- Font: Inter or similar — readable, professional, not decorative
- No stock photos — use solid colors and icons only
- No heavy animations — page must load fast

Output: single-page HTML deploy URL`;
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  try {
    const state = stateStore.loadState();
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) {
      entry.status   = status;
      entry.built_at = new Date().toISOString();
    }
    state.daily_stats = state.daily_stats || {};
    state.daily_stats.mockups_built = (state.daily_stats.mockups_built || 0) + 1;
    stateStore.saveState(state);
  } catch (e) {
    console.warn(`  Could not update state.json for ${leadId}: ${e.message}`);
  }
}

// ── SUBMIT MODE ───────────────────────────────────────────────────────────────

function handleSubmit() {
  if (!submitLead || !submitUrl) {
    console.error('Usage: node scripts/builder.js --submit --lead {lead_id} --url {lovable_url}');
    process.exit(1);
  }

  fs.mkdirSync(MOCKUPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(MOCKUPS_DIR, `${submitLead}-v1.txt`), submitUrl.trim());

  try {
    const state = stateStore.loadState();
    const entry = state.queue.find(l => l.lead_id === submitLead);
    if (entry) { entry.status = 'mockup_ready'; entry.built_at = new Date().toISOString(); }
    stateStore.saveState(state);
  } catch (e) {
    console.warn(`Could not update state.json: ${e.message}`);
  }

  console.log(`✓ Lovable URL recorded for ${submitLead}`);
  console.log(`  mockups/${submitLead}-v1.txt → ${submitUrl}`);
  console.log(`  Next: node scripts/filmer.js --force`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  if (isSubmit) return handleSubmit();

  console.log('\nBuilder starting');
  console.log('─'.repeat(50));

  fs.mkdirSync(MOCKUPS_DIR, { recursive: true });

  const config = loadConfig();
  checkAutoRun(config);
  const effectiveLimit = checkLimits(config);

  const briefs = loadPriorityBriefs(effectiveLimit);
  if (briefs.length === 0) {
    console.log('No priority leads ready. Run Checker first (priority=true briefs needed).');
    process.exit(0);
  }

  console.log(`Priority leads ready: ${briefs.length} | Daily limit: ${config.daily_limit}\n`);

  let built = 0;

  for (const brief of briefs) {
    const prompt     = generatePrompt(brief);
    const promptPath = path.join(MOCKUPS_DIR, `${brief.lead_id}-lovable-prompt.txt`);
    const v1Path     = path.join(MOCKUPS_DIR, `${brief.lead_id}-v1.txt`);

    fs.writeFileSync(promptPath, prompt);
    fs.writeFileSync(v1Path, 'prompt_ready');
    updateState(brief.lead_id, 'mockup_pending');

    config.built_today++;
    config.total_built++;
    saveConfig(config);
    built++;

    console.log(`✓ ${brief.business_name} (${brief.trade}, ${brief.city})`);
    console.log(`  Prompt saved: mockups/${brief.lead_id}-lovable-prompt.txt\n`);
    console.log('─── LOVABLE PROMPT ───────────────────────────────────────────');
    console.log(prompt);
    console.log('──────────────────────────────────────────────────────────────\n');
  }

  config.last_run = new Date().toISOString();
  saveConfig(config);

  writeLog('builder', [
    `prompts generated: ${built}`,
    `next: paste each into lovable.dev, then: node scripts/builder.js --submit --lead {id} --url {url}`
  ]);

  console.log('─'.repeat(50));
  console.log(`Done. ${built} prompt(s) saved to mockups/`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open lovable.dev and paste each prompt');
  console.log('  2. Copy the deploy URL');
  console.log('  3. node scripts/builder.js --submit --lead {lead_id} --url {url}');
  console.log('  4. node scripts/filmer.js --force');
  console.log('─'.repeat(50));
}

main();
