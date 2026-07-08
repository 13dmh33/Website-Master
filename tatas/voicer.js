'use strict';

// voicer.js — generates the voiceover mp3 for each approved reel via ElevenLabs.
//
// Realness pass: defaults to a newer, more natural model and more expressive
// voice settings than a flat "narrator" default, so the voice sounds like a
// person. Tune per-brand via env (TATAS_ELEVENLABS_*).
//
// For every approved reel that should be voiced and has no audio yet: calls
// ElevenLabs TTS with the script, saves website/social/tatas-reels/{week}/{id}.mp3,
// sets status 'voiced' and stores the path. Idempotent.
//
// A reel with voiceover === false (see --no-vo) is marked 'voiced' with NO audio
// so briefer bundles it as a captions-only / trending-audio reel — often the
// most native-feeling format on IG. Worth A/B-ing against the voiced version.
//
// usage:
//   node voicer.js               # voice all approved reels missing audio
//   node voicer.js --dry-run     # show what would be voiced, no API calls
//   node voicer.js --sample      # voice ONE short line to preview the voice/settings
//                                #   (cheap — do this before spending on full scripts)
//   node voicer.js --no-vo       # captions-only: mark approved reels voiced, no audio
//   node voicer.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const reelsState = require('./lib/reels-state');

const DRY_RUN = process.argv.includes('--dry-run');
const SAMPLE  = process.argv.includes('--sample');
const NO_VO   = process.argv.includes('--no-vo');
const REPO_ROOT = path.join(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');

const KEY      = process.env.TATAS_ELEVENLABS_KEY;
const VOICE_ID = process.env.TATAS_ELEVENLABS_VOICE_ID;
// eleven_turbo_v2_5 = natural + ~half the character cost of multilingual_v2.
// Swap to eleven_v3 for the most expressive prosody (audio tags) once you're set.
const MODEL     = process.env.TATAS_ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
// Lower stability = more expressive, human variation (a flat 0.5 sounds like a
// narrator). Style adds delivery; speaker boost tightens the voice identity.
const STABILITY = parseFloat(process.env.TATAS_ELEVENLABS_STABILITY || '0.35');
const SIMILARITY = parseFloat(process.env.TATAS_ELEVENLABS_SIMILARITY || '0.8');
const STYLE     = parseFloat(process.env.TATAS_ELEVENLABS_STYLE || '0.35');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function synthesize(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: {
        stability: STABILITY,
        similarity_boost: SIMILARITY,
        style: STYLE,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runSample() {
  if (!KEY || !VOICE_ID) { console.error('Set TATAS_ELEVENLABS_KEY + TATAS_ELEVENLABS_VOICE_ID to sample.'); process.exit(1); }
  const line = "Okay, real talk — this is what the Tech 4 Tatas voice sounds like. Warm, clear, human.";
  const outDir = path.join(WEBSITE_DIR, 'social', 'tatas-reels', '_samples');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `sample-${MODEL}-s${STABILITY}.mp3`);
  console.log(`Sampling voice ${VOICE_ID} · ${MODEL} · stability ${STABILITY} / style ${STYLE}...`);
  fs.writeFileSync(out, await synthesize(line));
  console.log(`✓ Sample saved: website${out.replace(WEBSITE_DIR, '')}  (${(fs.statSync(out).size/1024).toFixed(0)} KB)`);
  console.log('Listen, then adjust TATAS_ELEVENLABS_* env vars before voicing full scripts.');
}

async function main() {
  if (SAMPLE) return runSample();

  const current = reelsState.load();
  const weekOf  = argValue('--week');
  const targets = current.reels.filter(r =>
    r.status === 'approved' && !r.audioPath && (!weekOf || r.weekOf === weekOf)
  );

  if (!targets.length) {
    console.log('Nothing to voice — no approved reels missing audio.');
    return;
  }

  const wantAudio = !NO_VO;
  if (!DRY_RUN && wantAudio && (!KEY || !VOICE_ID)) {
    console.error('ElevenLabs not configured — set TATAS_ELEVENLABS_KEY + TATAS_ELEVENLABS_VOICE_ID (or use --no-vo for captions-only).');
    process.exit(1);
  }

  console.log(`Voicer: ${targets.length} approved reel(s)${NO_VO ? ' · captions-only (no voiceover)' : ` · ${MODEL} stability ${STABILITY}`}${DRY_RUN ? ' · dry run' : ''}.`);
  let voiced = 0, failed = 0;

  for (const reel of targets) {
    if (NO_VO || reel.voiceover === false) {
      if (DRY_RUN) { console.log(`  → would mark ${reel.id} voiced (captions-only, no audio)`); continue; }
      reelsState.updateReel(reel.id, { status: 'voiced', voiceover: false, audioPath: null, voicedAt: new Date().toISOString() });
      console.log(`  ✓ ${reel.id}: captions-only (no audio)`);
      voiced++;
      continue;
    }

    const audioDir = path.join(WEBSITE_DIR, 'social', 'tatas-reels', reel.weekOf);
    const relPath  = `/social/tatas-reels/${reel.weekOf}/${reel.id}.mp3`;

    if (DRY_RUN) {
      console.log(`  → would voice ${reel.id} (${reel.script.split(/\s+/).length} words) → ${relPath}`);
      continue;
    }

    try {
      fs.mkdirSync(audioDir, { recursive: true });
      const audio = await synthesize(reel.script);
      fs.writeFileSync(path.join(audioDir, `${reel.id}.mp3`), audio);
      reelsState.updateReel(reel.id, { status: 'voiced', audioPath: relPath, voicedAt: new Date().toISOString() });
      console.log(`  ✓ voiced: ${reel.id} → website${relPath} (${(audio.length / 1024).toFixed(0)} KB)`);
      voiced++;
    } catch (err) {
      console.error(`  ✗ ${reel.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${voiced} voiced, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch(err => {
  console.error(`voicer failed: ${err.message}`);
  process.exit(1);
});
