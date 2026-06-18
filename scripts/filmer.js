#!/usr/bin/env node
/**
 * Filmer — generates video instructions for each built mockup
 *
 * Usage:
 *   node scripts/filmer.js --force
 *   node scripts/filmer.js --submit --lead {lead_id} --url loom:{url}
 *
 * Reads:  mockups/{lead_id}-v1.txt   (must contain a real URL, not "prompt_ready")
 *         config/filmer-config.json
 * Writes: mockups/{lead_id}-video.txt      ("pending_manual" + Loom instructions)
 *         mockups/{lead_id}-screenshot.txt (ScreenshotOne URL, if API key set)
 *         state.json
 *         logs/{date}.log
 *
 * Screenshot: optional — set SCREENSHOTONE_API_KEY in .env.local
 * Video: manual Loom recording. Use --submit to record the URL when done.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs    = require('fs');
const path  = require('path');
const stateStore = require('./state-store');
const https = require('https');
const { writeLog } = require('./logger');

// ── PATHS ─────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'filmer-config.json');
const STATE_PATH  = path.join(ROOT, 'state.json');
const MOCKUPS_DIR = path.join(ROOT, 'mockups');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const getArg     = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag    = (flag) => args.includes(flag);
const isSubmit   = hasFlag('--submit');
const submitLead = getArg('--lead');
const submitUrl  = getArg('--url');

// ── CONFIG ────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      daily_limit:  5,
      auto_run:     false,
      today:        today(),
      filmed_today: 0,
      total_filmed: 0,
      last_run:     null
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
    console.log('Filmer is in manual mode (auto_run = false).');
    console.log('Run with --force to generate video instructions, or --submit to record a video URL.');
    process.exit(0);
  }
}

function checkLimits(config) {
  if (config.today !== today()) { config.today = today(); config.filmed_today = 0; }
  if (config.filmed_today >= config.daily_limit) {
    console.error(`DAILY LIMIT: ${config.filmed_today}/${config.daily_limit} already processed today.`);
    process.exit(1);
  }
  return config.daily_limit - config.filmed_today;
}

// ── LOAD READY MOCKUPS ────────────────────────────────────────────────────────

function loadReadyMockups(limit) {
  const hasVideo = new Set(
    fs.readdirSync(MOCKUPS_DIR)
      .filter(f => f.endsWith('-video.txt'))
      .map(f => f.replace('-video.txt', ''))
  );

  return fs.readdirSync(MOCKUPS_DIR)
    .filter(f => f.endsWith('-v1.txt'))
    .map(f => {
      const leadId = f.replace('-v1.txt', '');
      const url    = fs.readFileSync(path.join(MOCKUPS_DIR, f), 'utf8').trim();
      return { leadId, url };
    })
    .filter(({ leadId, url }) => !hasVideo.has(leadId) && url !== 'prompt_ready')
    .slice(0, limit);
}

// ── SCREENSHOT (ScreenshotOne) ────────────────────────────────────────────────

function takeScreenshot(siteUrl) {
  return new Promise((resolve) => {
    const apiKey = process.env.SCREENSHOTONE_API_KEY;
    if (!apiKey) return resolve(null);

    const params = new URLSearchParams({
      access_key:      apiKey,
      url:             siteUrl,
      viewport_width:  '390',
      viewport_height: '844',
      format:          'jpg',
      image_quality:   '85',
      full_page:       'true',
      block_ads:       'true'
    });

    const screenshotUrl = `https://api.screenshotone.com/take?${params}`;

    const req = https.request(
      { hostname: 'api.screenshotone.com', path: `/take?${params}`, method: 'HEAD' },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve(screenshotUrl);
        } else {
          console.warn(`  ScreenshotOne ${res.statusCode} — skipping screenshot`);
          resolve(null);
        }
      }
    );

    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  try {
    const state = stateStore.loadState();
    const entry = state.queue.find(l => l.lead_id === leadId);
    if (entry) { entry.status = status; entry.filmed_at = new Date().toISOString(); }
    stateStore.saveState(state);
  } catch (e) {
    console.warn(`  Could not update state.json for ${leadId}: ${e.message}`);
  }
}

// ── SUBMIT MODE ───────────────────────────────────────────────────────────────

function handleSubmit() {
  if (!submitLead || !submitUrl) {
    console.error('Usage: node scripts/filmer.js --submit --lead {lead_id} --url loom:{url}');
    process.exit(1);
  }

  fs.mkdirSync(MOCKUPS_DIR, { recursive: true });
  fs.writeFileSync(path.join(MOCKUPS_DIR, `${submitLead}-video.txt`), submitUrl.trim());
  updateState(submitLead, 'filmed');

  console.log(`✓ Video URL recorded for ${submitLead}`);
  console.log(`  mockups/${submitLead}-video.txt → ${submitUrl}`);
  console.log(`  This lead is now ready for Pitcher.`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isSubmit) return handleSubmit();

  console.log('\nFilmer starting');
  console.log('─'.repeat(50));

  fs.mkdirSync(MOCKUPS_DIR, { recursive: true });

  const config = loadConfig();
  checkAutoRun(config);
  const effectiveLimit = checkLimits(config);

  const mockups = loadReadyMockups(effectiveLimit);
  if (mockups.length === 0) {
    console.log('No mockups ready. Run: node scripts/builder.js --submit --lead {id} --url {url}');
    process.exit(0);
  }

  const hasScreenshotKey = !!process.env.SCREENSHOTONE_API_KEY;
  console.log(`Mockups ready: ${mockups.length} | Screenshot: ${hasScreenshotKey ? 'ScreenshotOne ✓' : 'not configured'}\n`);

  let processed = 0;

  for (const { leadId, url } of mockups) {
    console.log(`${leadId}`);
    console.log(`  Mockup URL: ${url}`);

    const screenshotUrl = await takeScreenshot(url);
    if (screenshotUrl) {
      fs.writeFileSync(path.join(MOCKUPS_DIR, `${leadId}-screenshot.txt`), screenshotUrl);
      console.log(`  Screenshot: captured`);
    }

    const instructions = [
      'pending_manual',
      '',
      `Record a 60-second Loom walkthrough of: ${url}`,
      'Show: hero → services → trust signals → contact form',
      'Keep it casual — you\'re showing what their new site could look like.',
      '',
      'When done, run:',
      `  node scripts/filmer.js --submit --lead ${leadId} --url loom:YOUR_LOOM_URL`
    ].join('\n');

    fs.writeFileSync(path.join(MOCKUPS_DIR, `${leadId}-video.txt`), instructions);
    updateState(leadId, 'film_pending');

    config.filmed_today++;
    config.total_filmed++;
    saveConfig(config);
    processed++;

    console.log(`  Video: pending_manual — see mockups/${leadId}-video.txt\n`);
  }

  config.last_run = new Date().toISOString();
  saveConfig(config);

  writeLog('filmer', [
    `processed: ${processed}  all pending manual Loom recording`,
    `screenshot_api: ${hasScreenshotKey ? 'screenshotone' : 'not configured'}`
  ]);

  console.log('─'.repeat(50));
  console.log(`Done. ${processed} lead(s) queued for Loom recording.`);
  console.log('');
  console.log('For each lead, record a Loom walkthrough of the mockup, then run:');
  console.log('  node scripts/filmer.js --submit --lead {lead_id} --url loom:{url}');
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
