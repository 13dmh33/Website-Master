'use strict';

// designer — image rendering agent (Techs4Tatas / Miley)
// runs after generator. Renders a 1080x1080 PNG (or carousel slides) per post
// using lib/canvas-render.js, then writes the image paths back onto each post.
//
// Backgrounds: product photo (assets/products/{key}.png) when present, else the
// content-type gradient palette. In October, non-photo cards use the pink
// 'awareness' palette (october-campaign.json visual_direction_october).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs      = require('fs');
const path    = require('path');
const render  = require('../lib/canvas-render');
const reel    = require('../lib/reel');
const store   = require('../lib/store');

function saveBuffer(buffer, filePath) {
  store.ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

// effective palette key — October shifts non-product cards to 'awareness'
function paletteFor(post) {
  if (post.isOctober) return 'awareness';
  return post.paletteKey || 'mission';
}

// parse "Slide 1: ... / Slide 2: ..." → [{headline, body}]
function parseSlides(post) {
  const slides = [];
  if (post.extra && /slide\s*\d+/i.test(post.extra)) {
    const parts = post.extra
      .split(/\/?\s*slide\s*\d+\s*:\s*/i)
      .map(s => s.trim())
      .filter(Boolean);
    for (const txt of parts) slides.push({ headline: txt, body: '' });
  }
  if (!slides.length) {
    // synthesize from hook/body/cta (evergreen carousels have no slide text)
    slides.push({ headline: post.hook, body: '' });
    if (post.body) slides.push({ headline: '', body: post.body });
    if (post.cta)  slides.push({ headline: post.cta, body: '' });
  }
  return slides;
}

async function renderCarousel(post, imageDir, idx) {
  const slides = parseSlides(post);
  const paletteKey = paletteFor(post);
  // selectTemplate (#11) — no-op (always 'v1Gradient') unless TEMPLATES_ACTIVE=true.
  const templateName = render.selectTemplate('carousel', { hasPhoto: !!post.product });
  const paths = [];
  for (let s = 0; s < slides.length; s++) {
    const outPath = path.join(imageDir, `${idx + 1}-${post.slot}-slide-0${s + 1}.png`);
    try {
      const buf = templateName === 'cleanCard'
        ? await render.renderCleanCard(slides[s].headline, slides[s].body, s + 1, slides.length)
        : await render.renderCarouselSlide({
            headline: slides[s].headline,
            body:     slides[s].body,
            slideNum: s + 1,
            total:    slides.length,
            paletteKey,
            productKey: post.product,
          });
      saveBuffer(buf, outPath);
      paths.push(outPath);
    } catch (err) {
      console.warn(`  slide ${s + 1} failed (${err.message}) — fallback.`);
      try { saveBuffer(await render.renderFallback(`${slides[s].headline} ${slides[s].body}`, paletteKey), outPath); paths.push(outPath); }
      catch (e2) { console.error(`  fallback failed: ${e2.message}`); }
    }
  }
  return paths;
}

// render a reel — dispatches on post.reel_style (set by the planner's weekly
// rotation): 'card' (default) or 'kinetic_karaoke' / 'kinetic_punch'.
async function renderReel(post, imageDir, idx) {
  const style = post.reel_style || 'card';
  if (style === 'kinetic_karaoke' || style === 'kinetic_punch') {
    return renderKineticReel(post, imageDir, idx, style === 'kinetic_punch' ? 'punch' : 'karaoke');
  }
  return renderCardReel(post, imageDir, idx);
}

// card style: one vertical (1080x1920) frame per beat, stitched into a silent
// .mp4 (lib/reel.js). Sets post.video; returns frame PNG paths for the preview.
// If ffmpeg is unavailable/fails, the frames still stand in as a storyboard.
async function renderCardReel(post, imageDir, idx) {
  const paletteKey = paletteFor(post);
  const beats = reel.parseBeats(post);
  const framePaths = [];

  for (let b = 0; b < beats.length; b++) {
    const outPath = path.join(imageDir, `${idx + 1}-${post.slot}-reel-frame-0${b + 1}.png`);
    try {
      const buf = await render.renderReelFrame({
        text:       beats[b].text,
        beatNum:    b + 1,
        total:      beats.length,
        paletteKey,
        productKey: post.product,
        isCta:      b === beats.length - 1 && beats.length > 1,
      });
      saveBuffer(buf, outPath);
      framePaths.push(outPath);
    } catch (err) {
      console.warn(`  ${post.slot} reel frame ${b + 1} failed (${err.message}) — fallback.`);
      try { saveBuffer(await render.renderFallback(beats[b].text, paletteKey), outPath); framePaths.push(outPath); }
      catch (e2) { console.error(`  reel frame fallback failed: ${e2.message}`); }
    }
  }

  post.video = null;
  if (framePaths.length) {
    const videoPath = path.join(imageDir, `${idx + 1}-${post.slot}-reel.mp4`);
    const durations = beats.slice(0, framePaths.length).map((b, i) => reel.beatDuration(i, b.text));
    try {
      await reel.assembleReel(framePaths, videoPath, { durations });
      post.video = videoPath;
      console.log(`  ${post.slot} reel (card) — ${framePaths.length} beats → ${path.basename(videoPath)}`);
    } catch (err) {
      console.warn(`  ${post.slot} reel video assembly skipped (${err.message}) — frames kept as storyboard.`);
    }
  }
  return framePaths;
}

// kinetic style: render one PNG per word-reveal state and hold each for its
// duration (concat demuxer). Returns one representative frame per beat for the
// preview strip (not all states); prunes the intermediate state PNGs on success.
async function renderKineticReel(post, imageDir, idx, mode) {
  const paletteKey = paletteFor(post);
  const beats = reel.parseBeats(post);
  const frames = [], durations = [], previewFrames = [];
  let seq = 0;

  for (let b = 0; b < beats.length; b++) {
    const isCtaBeat = b === beats.length - 1 && beats.length > 1;
    const states = reel.buildKineticStates(beats[b].text, { mode, isCtaBeat });
    let lastOfBeat = null;
    for (const st of states) {
      const outPath = path.join(imageDir, `${idx + 1}-${post.slot}-reel-${String(seq++).padStart(3, '0')}.png`);
      try {
        const buf = await render.renderReelWordFrame({
          text: beats[b].text, revealCount: st.revealCount, activeIndex: st.activeIndex, mode,
          beatNum: b + 1, total: beats.length, paletteKey, productKey: post.product, isCta: st.isCta,
        });
        saveBuffer(buf, outPath);
        frames.push(outPath); durations.push(st.duration); lastOfBeat = outPath;
      } catch (err) {
        console.warn(`  ${post.slot} kinetic frame (beat ${b + 1}) failed (${err.message}).`);
      }
    }
    if (lastOfBeat) previewFrames.push(lastOfBeat); // full-line state = the preview thumbnail
  }

  post.video = null;
  if (frames.length) {
    const videoPath = path.join(imageDir, `${idx + 1}-${post.slot}-reel.mp4`);
    try {
      await reel.assembleKineticReel(frames, durations, videoPath, {});
      post.video = videoPath;
      console.log(`  ${post.slot} reel (kinetic/${mode}) — ${beats.length} beats, ${frames.length} states → ${path.basename(videoPath)}`);
      // prune the intermediate state frames; keep only the per-beat preview stills
      const keep = new Set(previewFrames);
      for (const f of frames) if (!keep.has(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    } catch (err) {
      console.warn(`  ${post.slot} kinetic assembly skipped (${err.message}) — state frames kept as storyboard.`);
      return frames; // assembly failed: keep all states so nothing is lost
    }
  }
  return previewFrames;
}

async function renderSingle(post, imageDir, idx) {
  const paletteKey = paletteFor(post);
  const outPath = path.join(imageDir, `${idx + 1}-${post.slot}-${post.format}.png`);
  const hasPhoto = !!render.productImagePath(post.product);
  // selectTemplate (#11) — no-op (always 'v1Gradient') unless TEMPLATES_ACTIVE=true.
  const templateName = render.selectTemplate(post.format, { hasPhoto });
  try {
    let buf;
    // Product posts with a real photo always render over that photo (photoCard) —
    // the product IS the point of the post. The gradient renderSingle path only
    // runs for text-only posts, where its visual gate is calibrated correctly.
    if (hasPhoto) {
      const photoBuffer = fs.readFileSync(render.productImagePath(post.product));
      buf = await render.renderPhotoCard(post.hook, photoBuffer, '');
    } else if (templateName === 'cleanCard') {
      buf = await render.renderCleanCard(post.hook, '', 0, 0);
    } else {
      buf = await render.renderSingle({
        hook:       post.hook,
        sub:        '',
        paletteKey,
        productKey: post.product,
      });
    }
    saveBuffer(buf, outPath);
    return [outPath];
  } catch (err) {
    console.warn(`  ${post.slot} single failed (${err.message}) — fallback.`);
    try { saveBuffer(await render.renderFallback(post.hook, paletteKey), outPath); return [outPath]; }
    catch (e2) { console.error(`  fallback failed: ${e2.message}`); return []; }
  }
}

async function main() {
  const content = store.getLatestContent();
  if (!content || !content.posts) {
    console.error('No generated content found. Run node agents/generator.js first.');
    process.exit(1);
  }

  const { weekOf, posts } = content;
  const imageDir = path.join(store.paths.images, weekOf);
  store.ensureDir(imageDir);

  console.log(`Rendering images for week of ${weekOf} (${posts.length} posts).`);
  console.log(`Output directory: ${imageDir}`);

  let total = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    let images;
    if (post.format === 'carousel')   images = await renderCarousel(post, imageDir, i);
    else if (post.format === 'reel')  images = await renderReel(post, imageDir, i);
    else                              images = await renderSingle(post, imageDir, i);
    post.images = images;
    total += images.length;
    const vid = post.video ? ' + reel.mp4' : '';
    console.log(`  ${post.slot} ${post.contentType} (${post.format}) — ${images.length} image(s)${vid}.`);
  }

  store.savePost(content);
  console.log(`Design complete. ${total} images saved to ${imageDir}.`);
}

main().catch(err => {
  console.error(`Designer failed: ${err.message}`);
  process.exit(1);
});
