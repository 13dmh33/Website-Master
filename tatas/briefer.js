'use strict';

// briefer.js — turns each voiced reel into a CapCut-ready brief bundle.
//
// For every reel with status 'voiced': writes a Markdown bundle at
// website/review/tatas-reels/{week}/{id}.md containing the chosen hook, full
// script, shot list, caption + hashtags, and the audio file path. Then writes
// one index page (website/review/tatas-reels/{week}/index.html) linking all the
// week's bundles so they open from a phone.
//
// This is the end of the Phase 2 lane — what you take into CapCut. No posting,
// no video render here (that's Phase 2b, render.js). Idempotent: skips reels
// already briefed unless --force.
//
// usage:
//   node briefer.js               # brief all voiced reels for the latest week
//   node briefer.js --week 2026-07-13
//   node briefer.js --force       # rewrite bundles even if already briefed

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs   = require('fs');
const path = require('path');
const reelsState = require('./lib/reels-state');

const FORCE = process.argv.includes('--force');
const REPO_ROOT = path.join(__dirname, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');
const BASE_URL = (process.env.TATAS_SOCIAL_BASE_URL || 'https://trevoadvisors.com').replace(/\/$/, '');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function bundleMarkdown(reel) {
  const shots = reel.shotList.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `# Reel bundle — ${reel.topic}

**${reel.slot} · week of ${reel.weekOf}** · id \`${reel.id}\` · source: ${reel.source}

## Chosen hook
> ${reel.chosenHook || '(none chosen — approve in the review page first)'}

### Other hook options
${reel.hooks.map(h => `- ${h}`).join('\n')}

## Script (voiceover)
${reel.script}

## Shot list (on-screen text per frame)
${shots}

## Caption
${reel.caption}

${reel.hashtags.join(' ')}

## Voiceover audio
- File: \`website${reel.audioPath}\`
- URL: ${BASE_URL}${reel.audioPath}

---
### CapCut steps
1. Import the voiceover mp3 above as your audio track.
2. Add each shot-list line as an on-screen text frame, timed to the script.
3. Add trending audio in-app (low volume under the voiceover).
4. Paste the caption + hashtags when publishing.
`;
}

function indexHtml(reels, weekOf) {
  const rows = reels.map(r => `
    <li>
      <a href="./${encodeURIComponent(r.id)}.md">${r.slot} · ${r.topic.replace(/</g, '&lt;')}</a>
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
  li a { color:#FFC400; font-weight:600; text-decoration:none; display:block; margin-bottom:.5rem; }
  audio { width:100%; }
</style></head><body>
  <h1>Reel bundles — week of ${weekOf}</h1>
  <p class="sub">${reels.length} ready for CapCut. Tap a title for the full brief; play the voiceover inline.</p>
  <ul>${rows}</ul>
</body></html>`;
}

function main() {
  const current = reelsState.load();
  const weekOf  = argValue('--week') || reelsState.latestWeek(current);
  if (!weekOf) {
    console.log('reels[] is empty — run the lane first.');
    process.exit(0);
  }

  const voiced = current.reels.filter(r => r.weekOf === weekOf && r.status === 'voiced');
  if (!voiced.length) {
    console.log(`No voiced reels for week ${weekOf} — run voicer.js first.`);
    return;
  }

  const bundleDir = path.join(WEBSITE_DIR, 'review', 'tatas-reels', weekOf);
  fs.mkdirSync(bundleDir, { recursive: true });

  let written = 0, skipped = 0;
  for (const reel of voiced) {
    if (reel.briefedAt && !FORCE) {
      console.log(`  – ${reel.id}: already briefed — skipping (use --force to rewrite)`);
      skipped++;
      continue;
    }
    fs.writeFileSync(path.join(bundleDir, `${reel.id}.md`), bundleMarkdown(reel), 'utf8');
    reelsState.updateReel(reel.id, { briefedAt: new Date().toISOString() });
    console.log(`  ✓ bundle: review/tatas-reels/${weekOf}/${reel.id}.md`);
    written++;
  }

  fs.writeFileSync(path.join(bundleDir, 'index.html'), indexHtml(voiced, weekOf), 'utf8');
  console.log(`Index: review/tatas-reels/${weekOf}/index.html → ${BASE_URL}/review/tatas-reels/${weekOf}/`);
  console.log(`\nDone. ${written} bundle(s) written, ${skipped} already briefed.`);
}

main();
