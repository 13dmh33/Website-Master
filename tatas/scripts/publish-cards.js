'use strict';

// publish-cards.js — host the week's carousel slides + review preview on the
// Netlify site. Adapted from Miley's proven module; reads/writes
// tatas/state.json instead of queue files.
//
// The Instagram Graph API can't take an image upload — it fetches a public
// URL, and only accepts JPEG. This script bridges the gap:
//   1. converts each post's PNG slides to JPEG under
//      website/social/tatas/{weekOf}/  (served at {BASE}/social/tatas/...)
//   2. writes the web paths back onto each post as `publicImages`
//   3. builds a self-contained review preview (images inlined base64) at
//      website/review/tatas/index.html → {BASE}/review/tatas/
//
// Runs in the weekly pipeline after designer.js; the workflow commits
// website/ so Netlify deploys. Idempotent — safe to re-run.
//
// usage:
//   node scripts/publish-cards.js               # latest week in state.json
//   node scripts/publish-cards.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { Canvas, loadImage } = require('skia-canvas');
const state = require('../lib/state');

const TATAS_ROOT   = path.join(__dirname, '..');
const REPO_ROOT    = path.join(TATAS_ROOT, '..');
const WEBSITE_DIR  = path.join(REPO_ROOT, 'website');
const JPEG_QUALITY = 0.9;

// state.json stores image paths relative to tatas/ (absolute tolerated)
function resolveImage(p) {
  return path.isAbsolute(p) ? p : path.join(TATAS_ROOT, p);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function pngToJpeg(pngPath, jpegPath) {
  const img    = await loadImage(fs.readFileSync(pngPath));
  const canvas = new Canvas(img.width, img.height);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; // PNG transparency would otherwise go black in JPEG
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  fs.writeFileSync(jpegPath, await canvas.toBuffer('jpg', { quality: JPEG_QUALITY }));
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPreview(posts, weekOf) {
  const cards = posts.map(p => {
    const imgs = (p.images || [])
      .map(resolveImage)
      .filter(f => fs.existsSync(f))
      .map(f => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" alt="${p.slot}" />`)
      .join('');
    return `
    <div class="post">
      <h2>${p.slot} ${p.time} MT · ${escapeHtml(p.topic)} <span class="src">${p.source}</span></h2>
      <div class="time">posts: ${p.scheduledFor} · status: ${p.status}</div>
      ${imgs}
      <pre class="cap">${escapeHtml(p.postText)}</pre>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tech 4 Tatas — week of ${weekOf}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#1A1A1D; color:#F7F4F0; padding:2rem; }
  h1 { color:#FF2E88; margin-bottom:.2rem; }
  p.sub { color:#FFB3D1; margin-top:0; }
  .post { background:#232327; border:1px solid #333; border-radius:14px; padding:1.5rem; margin-bottom:1.75rem; max-width:680px; }
  .post h2 { color:#FF2E88; margin:0 0 .25rem; font-size:1rem; }
  .src { color:#FFC400; font-size:.8rem; }
  .time { color:#8a8a90; font-size:.8rem; margin-bottom:1rem; }
  .post img { max-width:100%; border-radius:10px; display:block; margin-bottom:.75rem; }
  pre.cap { white-space:pre-wrap; font-family:inherit; font-size:.95rem; line-height:1.6; background:#1A1A1D; padding:1rem; border-radius:8px; }
</style></head><body>
  <h1>Tech 4 Tatas — carousel preview</h1>
  <p class="sub">Week of ${weekOf} · ${posts.length} posts · approve via the tatas-approve-week GitHub Action</p>
  ${cards}
</body></html>`;
}

async function main() {
  const current = state.load();
  const weekOf  = argValue('--week') || state.latestWeek(current);
  if (!weekOf) {
    console.log('state.json has no posts — run writer.js + designer.js first.');
    process.exit(0);
  }

  const posts = current.posts.filter(p => p.weekOf === weekOf);
  const cardDir = path.join(WEBSITE_DIR, 'social', 'tatas', weekOf);
  fs.mkdirSync(cardDir, { recursive: true });

  console.log(`Publishing cards for week of ${weekOf} → website/social/tatas/${weekOf}/`);
  let converted = 0, missing = 0;

  for (const post of posts) {
    const publicImages = [];
    for (const imgPath of (post.images || []).map(resolveImage)) {
      if (!fs.existsSync(imgPath)) {
        console.warn(`  ✗ missing render: ${imgPath} (${post.id})`);
        missing++;
        continue;
      }
      const jpegName = path.basename(imgPath).replace(/\.png$/i, '.jpg');
      await pngToJpeg(imgPath, path.join(cardDir, jpegName));
      publicImages.push(`/social/tatas/${weekOf}/${jpegName}`);
      converted++;
    }
    state.updatePost(post.id, { publicImages });
    console.log(`  ${post.slot} ${post.topicKey}: ${publicImages.length} slide(s) hosted`);
  }

  const reviewDir = path.join(WEBSITE_DIR, 'review', 'tatas');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, 'index.html'), buildPreview(posts, weekOf), 'utf8');
  console.log('Preview published → website/review/tatas/index.html');

  console.log(`Done. ${converted} slide(s) converted to JPEG, ${missing} missing.`);
  if (missing) process.exit(1);
}

main().catch(err => {
  console.error(`publish-cards failed: ${err.message}`);
  process.exit(1);
});
