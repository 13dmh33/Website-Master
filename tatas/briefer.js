'use strict';

// briefer.js — turns each voiced reel into a CapCut-ready brief bundle.
//
// Realness pass: the bundle is built to produce a real-looking edit, not a
// text-card slideshow —
//   - per-beat B-ROLL (real footage) with a ready-to-use Pexels link, or actual
//     candidate clip URLs if TATAS_PEXELS_KEY is set
//   - per-beat TIMING derived from the script length, so captions track the VO
//   - explicit "auto-caption, word-by-word" instruction (the strongest
//     "a human edited this" signal)
//   - handles captions-only reels (no voiceover → ride trending audio)
//
// Writes website/review/tatas-reels/{week}/{id}.md per reel + one index.html.
// End of the Phase 2 lane — no posting, no render (that's Phase 2b). Idempotent
// via briefedAt / --force.
//
// usage:
//   node briefer.js               # brief voiced reels, latest week
//   node briefer.js --week 2026-07-13
//   node briefer.js --force

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const reelsState = require('./lib/reels-state');

const FORCE = process.argv.includes('--force');
const REPO_ROOT = path.join(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');
const BASE_URL = (process.env.TATAS_SOCIAL_BASE_URL || 'https://trevoadvisors.com').replace(/\/$/, '');
const PEXELS_KEY = process.env.TATAS_PEXELS_KEY;

// ~2.8 words/sec is a natural spoken pace; used to spread beat timings across
// the estimated script duration.
const WORDS_PER_SEC = 2.8;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// spread N beats across the estimated script duration → [{start, end}] seconds
function beatTimings(script, nBeats) {
  const totalSec = Math.max(nBeats * 2, Math.round(script.trim().split(/\s+/).length / WORDS_PER_SEC));
  const per = totalSec / nBeats;
  return Array.from({ length: nBeats }, (_, i) => ({
    start: Math.round(i * per),
    end:   Math.round((i + 1) * per),
  }));
}

// pull up to 2 candidate portrait clip URLs from Pexels for a b-roll phrase
async function pexelsClips(query) {
  if (!PEXELS_KEY) return null;
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=2`;
    const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.videos || []).map(v => v.url);
  } catch { return null; }
}

function pexelsSearchLink(query) {
  return `https://www.pexels.com/search/videos/${encodeURIComponent(query)}/?orientation=portrait`;
}

async function bundleMarkdown(reel) {
  const timings = beatTimings(reel.script, reel.beats.length);
  const isVoiced = reel.voiceover !== false && reel.audioPath;

  const beatRows = [];
  for (let i = 0; i < reel.beats.length; i++) {
    const b = reel.beats[i];
    const t = timings[i];
    const clips = await pexelsClips(b.broll);
    const footage = clips && clips.length
      ? clips.map(u => `[clip](${u})`).join(' · ')
      : `[search Pexels](${pexelsSearchLink(b.broll)})`;
    beatRows.push(`| ${t.start}–${t.end}s | \`${b.caption}\` | ${b.broll} — ${footage} |`);
  }

  const audioLine = isVoiced
    ? `- Voiceover: \`website${reel.audioPath}\` · ${BASE_URL}${reel.audioPath}`
    : `- **Captions-only reel** — no voiceover. Build it on trending audio + captions.`;

  return `# Reel bundle — ${reel.topic}

**${reel.slot} · week of ${reel.weekOf}** · id \`${reel.id}\` · source: ${reel.source} · ${isVoiced ? 'voiceover' : 'captions-only'}

## Chosen hook
> ${reel.chosenHook || '(none chosen — approve in the review page first)'}

### Other hook options
${reel.hooks.map(h => `- ${h}`).join('\n')}

## Script (voiceover)
${reel.script}

## Beats — real footage + on-screen caption + timing
| Time | Caption (on-screen) | B-roll |
|------|---------------------|--------|
${beatRows.join('\n')}

## Caption
${reel.caption}

${reel.hashtags.join(' ')}

## Audio
${audioLine}

---
### CapCut steps
1. ${isVoiced ? 'Import the voiceover mp3 as your base audio track.' : 'Add a trending audio track (this reel has no voiceover).'}
2. Drop in a b-roll clip per beat (links above), trimmed to the times in the table.
3. Turn on **Auto Captions** and style them word-by-word (native look) — do not use full-sentence static cards.
4. ${isVoiced ? 'Optional: add trending audio low under the voiceover for reach.' : 'Keep captions synced to the beat; let the trending audio carry it.'}
5. Paste the caption + hashtags when publishing. Add trending audio in-app if you haven't.
`;
}

function indexHtml(reels, weekOf) {
  const rows = reels.map(r => `
    <li>
      <a href="./${encodeURIComponent(r.id)}.md">${r.slot} · ${r.topic.replace(/</g, '&lt;')}</a>
      <span class="tag">${r.voiceover === false || !r.audioPath ? 'captions-only' : 'voiceover'}</span>
      ${r.audioPath ? `<audio controls preload="none" src="${r.audioPath}"></audio>` : ''}
    </li>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tech 4 Tatas Reels — bundles for ${weekOf}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#1A1A1D; color:#F7F4F0; padding:1.25rem; max-width:720px; margin:0 auto; }
  h1 { color:#FF2E88; } p.sub { color:#FFB3D1; font-size:.9rem; margin-top:0; }
  ul { list-style:none; padding:0; }
  li { background:#232327; border:1px solid #333; border-radius:12px; padding:1rem; margin-bottom:1rem; }
  li a { color:#FFC400; font-weight:600; text-decoration:none; display:block; margin-bottom:.4rem; }
  .tag { font-size:.7rem; color:#8a8a90; } audio { width:100%; margin-top:.5rem; }
</style></head><body>
  <h1>Reel bundles — week of ${weekOf}</h1>
  <p class="sub">${reels.length} ready for CapCut. Tap a title for the full brief (beats + b-roll links + timing).</p>
  <ul>${rows}</ul>
</body></html>`;
}

async function main() {
  const current = reelsState.load();
  const weekOf  = argValue('--week') || reelsState.latestWeek(current);
  if (!weekOf) { console.log('reels[] is empty — run the lane first.'); process.exit(0); }

  const voiced = current.reels.filter(r => r.weekOf === weekOf && r.status === 'voiced');
  if (!voiced.length) { console.log(`No voiced reels for week ${weekOf} — run voicer.js first.`); return; }

  const bundleDir = path.join(WEBSITE_DIR, 'review', 'tatas-reels', weekOf);
  fs.mkdirSync(bundleDir, { recursive: true });
  if (PEXELS_KEY) console.log('Pexels key set — resolving candidate b-roll clips per beat.');

  let written = 0, skipped = 0;
  for (const reel of voiced) {
    if (reel.briefedAt && !FORCE) {
      console.log(`  – ${reel.id}: already briefed — skipping (use --force to rewrite)`);
      skipped++;
      continue;
    }
    fs.writeFileSync(path.join(bundleDir, `${reel.id}.md`), await bundleMarkdown(reel), 'utf8');
    reelsState.updateReel(reel.id, { briefedAt: new Date().toISOString() });
    console.log(`  ✓ bundle: review/tatas-reels/${weekOf}/${reel.id}.md`);
    written++;
  }

  fs.writeFileSync(path.join(bundleDir, 'index.html'), indexHtml(voiced, weekOf), 'utf8');
  console.log(`Index → ${BASE_URL}/review/tatas-reels/${weekOf}/`);
  console.log(`\nDone. ${written} bundle(s) written, ${skipped} already briefed.`);
}

main().catch(err => {
  console.error(`briefer failed: ${err.message}`);
  process.exit(1);
});
