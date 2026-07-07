'use strict';

// render.js — Phase 2b (OPTIONAL, OFF by default).
//
// Given a briefed reel's shot list + voiceover audio, calls the Shotstack
// template render API to produce a base MP4 with burned-in captions, saved
// next to the audio at website/social/tatas-reels/{week}/{id}.mp4.
//
// This is NOT wired into any workflow and does nothing unless BOTH:
//   - TATAS_SHOTSTACK_KEY is set, and
//   - you pass --enable
// The Phase 2 deliverable ends at the CapCut brief bundle (briefer.js); this
// module is a getting-started scaffold for automated rendering. It is
// deliberately conservative: it refuses to run without the explicit flag so it
// can never fire by accident or spend on the render API.
//
// Reels still need trending audio added in-app, so even a rendered MP4 is a
// starting point, not a finished post — this lane never auto-posts.
//
// usage (manual, opt-in only):
//   node render.js --enable                 # render voiced+briefed reels, latest week
//   node render.js --enable --week 2026-07-13
//   node render.js --dry-run --enable       # show the Shotstack payload, no API call

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const reelsState = require('./lib/reels-state');

const ENABLE  = process.argv.includes('--enable');
const DRY_RUN = process.argv.includes('--dry-run');
const KEY     = process.env.TATAS_SHOTSTACK_KEY;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// Build the Shotstack timeline JSON for one reel (captions burned per shot,
// voiceover as the soundtrack). Wired for the real API in a later pass.
function buildTimeline(reel) {
  const perShot = 3; // seconds per caption frame — tune against audio length later
  const clips = reel.shotList.map((text, i) => ({
    asset: { type: 'html', html: `<p style="color:#fff;font:700 54px sans-serif;text-align:center">${text}</p>`, width: 1080, height: 1920 },
    start: i * perShot,
    length: perShot,
  }));
  return {
    timeline: {
      background: '#1A1A1D',
      soundtrack: { src: 'AUDIO_URL_PLACEHOLDER', effect: 'fadeOut' },
      tracks: [{ clips }],
    },
    output: { format: 'mp4', size: { width: 1080, height: 1920 } },
  };
}

function main() {
  if (!ENABLE) {
    console.log('render.js is Phase 2b and OFF by default. Pass --enable to opt in.');
    console.log('The Phase 2 deliverable ends at the CapCut brief bundle (briefer.js).');
    return;
  }
  if (!KEY && !DRY_RUN) {
    console.error('TATAS_SHOTSTACK_KEY is not set — cannot render. (Set it, or use --dry-run to preview the payload.)');
    process.exit(1);
  }

  const current = reelsState.load();
  const weekOf  = argValue('--week') || reelsState.latestWeek(current);
  const targets = current.reels.filter(r =>
    r.weekOf === weekOf && r.status === 'voiced' && r.briefedAt && !r.videoPath
  );

  if (!targets.length) {
    console.log(`No voiced+briefed reels awaiting render for week ${weekOf}.`);
    return;
  }

  console.log(`render.js (Phase 2b) — ${targets.length} reel(s)${DRY_RUN ? ' · DRY RUN' : ''}`);
  for (const reel of targets) {
    const timeline = buildTimeline(reel);
    if (DRY_RUN) {
      console.log(`\n--- ${reel.id} Shotstack payload ---`);
      console.log(JSON.stringify(timeline, null, 2));
      continue;
    }
    // Real Shotstack submit + poll + download is intentionally left for Phase 2b.
    console.log(`  (stub) would submit ${reel.id} to Shotstack and save the MP4 next to the audio.`);
  }
  console.log('\nrender.js is a Phase 2b scaffold — see CHECKPOINT-phase2.md.');
}

main();
