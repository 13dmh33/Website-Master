'use strict';

// publish-cards.js — host the week's cards + review preview on the Netlify site.
//
// The Instagram Graph API can't take an image upload — it fetches a public URL,
// and only accepts JPEG. This script bridges the gap:
//   1. converts each queued post's PNG cards to JPEG under
//      website/social/miley/{weekOf}/   (served at {SOCIAL_BASE_URL}/social/miley/...)
//   2. writes the web paths back onto each queue record as `publicImages`
//   3. copies the self-contained review preview to website/review/miley/index.html
//      so Dave can review the week from his phone at {SOCIAL_BASE_URL}/review/miley/
//
// Runs in the weekly pipeline right after the scheduler; the workflow commits
// website/ so Netlify deploys the files. Idempotent — safe to re-run.
//
// usage:
//   node scripts/publish-cards.js               # latest week in the queue
//   node scripts/publish-cards.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const { Canvas, loadImage } = require('skia-canvas');
const store = require('../lib/store');

const REPO_ROOT   = path.join(__dirname, '..', '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');
const JPEG_QUALITY = 0.9;

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// all queue records (with their filenames), newest week first
function loadQueueRecords() {
  const queueDir = store.paths.queue;
  if (!fs.existsSync(queueDir)) return [];
  return fs.readdirSync(queueDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('preview-'))
    .map(f => {
      const filePath = path.join(queueDir, f);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { file: f, filePath, data };
    });
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

async function main() {
  const records = loadQueueRecords();
  if (!records.length) {
    console.log('Queue is empty — run the pipeline (scheduler) first.');
    process.exit(0);
  }

  const weeks  = [...new Set(records.map(r => r.data.weekOf))].sort();
  const weekOf = argValue('--week') || weeks[weeks.length - 1];
  const weekRecords = records.filter(r => r.data.weekOf === weekOf);
  if (!weekRecords.length) {
    console.error(`No queue records for week ${weekOf}. Weeks in queue: ${weeks.join(', ')}`);
    process.exit(1);
  }

  const cardDir = path.join(WEBSITE_DIR, 'social', 'miley', weekOf);
  fs.mkdirSync(cardDir, { recursive: true });

  console.log(`Publishing cards for week of ${weekOf} → website/social/miley/${weekOf}/`);
  let converted = 0, missing = 0;

  for (const rec of weekRecords) {
    const publicImages = [];
    for (const imgPath of (rec.data.images || [])) {
      if (!fs.existsSync(imgPath)) {
        console.warn(`  ✗ missing render: ${imgPath} (${rec.file})`);
        missing++;
        continue;
      }
      const jpegName = path.basename(imgPath).replace(/\.png$/i, '.jpg');
      await pngToJpeg(imgPath, path.join(cardDir, jpegName));
      publicImages.push(`/social/miley/${weekOf}/${jpegName}`);
      converted++;
    }
    rec.data.publicImages = publicImages;
    fs.writeFileSync(rec.filePath, JSON.stringify(rec.data, null, 2), 'utf8');
    console.log(`  ${rec.data.slot || rec.file}: ${publicImages.length} card(s) hosted`);
  }

  // preview → phone-reviewable URL (self-contained HTML, images inlined as base64)
  const previewSrc = path.join(store.paths.queue, `preview-${weekOf}.html`);
  if (fs.existsSync(previewSrc)) {
    const reviewDir = path.join(WEBSITE_DIR, 'review', 'miley');
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.copyFileSync(previewSrc, path.join(reviewDir, 'index.html'));
    console.log(`Preview published → website/review/miley/index.html`);
  } else {
    console.warn(`No preview found at ${previewSrc} — scheduler not run for this week?`);
  }

  console.log(`Done. ${converted} card(s) converted to JPEG, ${missing} missing.`);
  if (missing) process.exit(1);
}

main().catch(err => {
  console.error(`publish-cards failed: ${err.message}`);
  process.exit(1);
});
