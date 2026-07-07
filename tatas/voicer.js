'use strict';

// voicer.js — generates the voiceover mp3 for each approved reel via ElevenLabs.
//
// For every approved reel WITHOUT audio: calls ElevenLabs text-to-speech with
// the script, saves website/social/tatas-reels/{week}/{id}.mp3, sets status
// 'voiced' and stores the path. Idempotent — skips anything already voiced.
//
// Needs TATAS_ELEVENLABS_KEY + TATAS_ELEVENLABS_VOICE_ID. Without them the run
// errors (like Phase 1's post-due without a token), unless --dry-run.
//
// usage:
//   node voicer.js             # voice all approved reels missing audio
//   node voicer.js --dry-run   # show what would be voiced, no API calls
//   node voicer.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const reelsState = require('./lib/reels-state');

const DRY_RUN = process.argv.includes('--dry-run');
const REPO_ROOT = path.join(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');

const KEY      = process.env.TATAS_ELEVENLABS_KEY;
const VOICE_ID = process.env.TATAS_ELEVENLABS_VOICE_ID;
const MODEL    = process.env.TATAS_ELEVENLABS_MODEL || 'eleven_multilingual_v2';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function synthesize(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key':   KEY,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const current = reelsState.load();
  const weekOf  = argValue('--week');

  const targets = current.reels.filter(r =>
    r.status === 'approved' && !r.audioPath &&
    (!weekOf || r.weekOf === weekOf)
  );

  if (!targets.length) {
    console.log('Nothing to voice — no approved reels missing audio.');
    return;
  }

  if (!DRY_RUN && (!KEY || !VOICE_ID)) {
    console.error('ElevenLabs not configured — set TATAS_ELEVENLABS_KEY + TATAS_ELEVENLABS_VOICE_ID.');
    process.exit(1);
  }

  console.log(`Voicer: ${targets.length} approved reel(s) to voice${DRY_RUN ? ' (dry run)' : ''}.`);
  let voiced = 0, failed = 0;

  for (const reel of targets) {
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
      reelsState.updateReel(reel.id, {
        status: 'voiced',
        audioPath: relPath,
        voicedAt: new Date().toISOString(),
      });
      console.log(`  ✓ voiced: ${reel.id} → website${relPath} (${(audio.length / 1024).toFixed(0)} KB)`);
      voiced++;
    } catch (err) {
      console.error(`  ✗ ${reel.id}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${voiced} voiced, ${failed} failed.`);
  if (failed) process.exit(1); // non-zero → workflow failure alert fires
}

main().catch(err => {
  console.error(`voicer failed: ${err.message}`);
  process.exit(1);
});
