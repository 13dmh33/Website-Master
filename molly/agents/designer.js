'use strict';

// designer — image rendering agent for Molly
// runs after generator — renders PNG images using skia-canvas
// saves to output/images/[YYYY-MM-DD]/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs     = require('fs');
const path   = require('path');
const render = require('../lib/canvas-render');
const reel   = require('../lib/reel');
const store  = require('../lib/store');

function saveBuffer(buffer, filePath) {
  store.ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

async function renderSlide(headline, body, slideNum, totalSlides, outPath, niche = 'education') {
  try {
    const buf = await render.renderCarouselSlide(headline, body, slideNum, totalSlides, niche);
    saveBuffer(buf, outPath);
    return true;
  } catch (err) {
    console.warn(`Slide ${slideNum} render failed (${err.message}) — using fallback.`);
    try {
      const fallback = await render.renderFallback(`${headline}\n\n${body}`, niche);
      saveBuffer(fallback, outPath);
      return true;
    } catch (e2) {
      console.error(`Fallback render also failed for slide ${slideNum}: ${e2.message}`);
      return false;
    }
  }
}

async function renderSingleImage(text, attribution, outPath, niche = 'results') {
  try {
    const buf = await render.renderQuotePost(text, attribution, niche);
    saveBuffer(buf, outPath);
    return true;
  } catch (err) {
    console.warn(`Single image render failed (${err.message}) — using fallback.`);
    try {
      const fallback = await render.renderFallback(`${text}\n\n${attribution || ''}`, niche);
      saveBuffer(fallback, outPath);
      return true;
    } catch (e2) {
      console.error(`Fallback render failed: ${e2.message}`);
      return false;
    }
  }
}

// render a reel — dispatches on the week's reel style (lib/planner.js's
// weekly rotation, saved on content.reelStyle): 'card' (default) or
// 'kinetic_karaoke' / 'kinetic_punch'. Returns { images, video } — images are
// PNG paths for the review preview, video is the assembled .mp4 path (or null
// if ffmpeg assembly failed, in which case the frames stand in as a storyboard).
async function renderReel(reelPost, imageDir, style) {
  if (style === 'kinetic_karaoke' || style === 'kinetic_punch') {
    return renderKineticReel(reelPost, imageDir, style === 'kinetic_punch' ? 'punch' : 'karaoke');
  }
  return renderCardReel(reelPost, imageDir);
}

// card style: one vertical (1080x1920) frame per beat, stitched into a silent
// .mp4 (lib/reel.js). If ffmpeg is unavailable/fails, the frames still stand
// in as a storyboard.
async function renderCardReel(reelPost, imageDir) {
  const beats = reel.parseBeats(reelPost);
  const framePaths = [];

  for (let b = 0; b < beats.length; b++) {
    const outPath = path.join(imageDir, `reel-frame-0${b + 1}.png`);
    try {
      const buf = await render.renderReelFrame({
        text:    beats[b].text,
        beatNum: b + 1,
        total:   beats.length,
        niche:   'reel',
        isCta:   b === beats.length - 1 && beats.length > 1,
      });
      saveBuffer(buf, outPath);
      framePaths.push(outPath);
    } catch (err) {
      console.warn(`  reel frame ${b + 1} failed (${err.message}) — fallback.`);
      try { saveBuffer(await render.renderFallback(beats[b].text, 'reel'), outPath); framePaths.push(outPath); }
      catch (e2) { console.error(`  reel frame fallback failed: ${e2.message}`); }
    }
  }

  let video = null;
  if (framePaths.length) {
    const videoPath = path.join(imageDir, 'reel.mp4');
    const durations = beats.slice(0, framePaths.length).map((b, i) => reel.beatDuration(i, b.text));
    try {
      await reel.assembleReel(framePaths, videoPath, { durations });
      video = videoPath;
      console.log(`  reel (card) — ${framePaths.length} beats → ${path.basename(videoPath)}`);
    } catch (err) {
      console.warn(`  reel video assembly skipped (${err.message}) — frames kept as storyboard.`);
    }
  }
  return { images: framePaths, video };
}

// kinetic style: render one PNG per word-reveal state and hold each for its
// duration (concat demuxer). Returns one representative frame per beat for the
// preview strip (not all states); prunes the intermediate state PNGs on success.
async function renderKineticReel(reelPost, imageDir, mode) {
  const beats = reel.parseBeats(reelPost);
  const frames = [], durations = [], previewFrames = [];
  let seq = 0;

  for (let b = 0; b < beats.length; b++) {
    const isCtaBeat = b === beats.length - 1 && beats.length > 1;
    const states = reel.buildKineticStates(beats[b].text, { mode, isCtaBeat });
    let lastOfBeat = null;
    for (const st of states) {
      const outPath = path.join(imageDir, `reel-${String(seq++).padStart(3, '0')}.png`);
      try {
        const buf = await render.renderReelWordFrame({
          text: beats[b].text, revealCount: st.revealCount, activeIndex: st.activeIndex, mode,
          beatNum: b + 1, total: beats.length, niche: 'reel', isCta: st.isCta,
        });
        saveBuffer(buf, outPath);
        frames.push(outPath); durations.push(st.duration); lastOfBeat = outPath;
      } catch (err) {
        console.warn(`  kinetic frame (beat ${b + 1}) failed (${err.message}).`);
      }
    }
    if (lastOfBeat) previewFrames.push(lastOfBeat); // full-line state = the preview thumbnail
  }

  let video = null;
  if (frames.length) {
    const videoPath = path.join(imageDir, 'reel.mp4');
    try {
      await reel.assembleKineticReel(frames, durations, videoPath, {});
      video = videoPath;
      console.log(`  reel (kinetic/${mode}) — ${beats.length} beats, ${frames.length} states → ${path.basename(videoPath)}`);
      const keep = new Set(previewFrames);
      for (const f of frames) if (!keep.has(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    } catch (err) {
      console.warn(`  kinetic assembly skipped (${err.message}) — state frames kept as storyboard.`);
      return { images: frames, video: null }; // assembly failed: keep all states so nothing is lost
    }
  }
  return { images: previewFrames, video };
}

async function main() {
  const content = store.getLatestContent();
  if (!content) {
    console.error('No generated content found. Run node agents/generator.js first.');
    process.exit(1);
  }

  const { weekOf, posts, niches = {} } = content;
  const imageDir = path.join(store.paths.images, weekOf);
  store.ensureDir(imageDir);

  console.log(`Rendering images for week of ${weekOf}.`);
  console.log(`Output directory: ${imageDir}`);

  const imagePaths = {};

  // 1. carousel slides
  const { slides } = posts.carousel;
  const carouselPaths = [];
  console.log(`Rendering ${slides.length} carousel slides...`);
  for (let i = 0; i < slides.length; i++) {
    const slide   = slides[i];
    const outPath = path.join(imageDir, `carousel-slide-0${i + 1}.png`);
    const ok      = await renderSlide(slide.headline, slide.body || '', i + 1, slides.length, outPath, 'carousel');
    if (ok) carouselPaths.push(outPath);
  }
  imagePaths.carousel = carouselPaths;
  console.log(`Carousel: ${carouselPaths.length}/${slides.length} slides rendered.`);

  // 2. caption image — editorial style with hook + body
  const captionBody = posts.caption1.variantA || posts.caption1.body || '';
  const captionHook = captionBody.split('\n').find(l => l.trim().length > 10) || '';
  const caption1Path = path.join(imageDir, 'caption-1.png');
  try {
    const buf = await render.renderCaptionPost(captionHook, captionBody, niches.caption || 'results');
    saveBuffer(buf, caption1Path);
    imagePaths.caption1 = [caption1Path];
    console.log('Caption image rendered.');
  } catch (err) {
    console.warn(`Caption render failed: ${err.message}`);
    imagePaths.caption1 = [];
  }

  // 3. trevo_found — demo site or agent product reveal
  const tf      = posts.trevo_found;
  const tfPath  = path.join(imageDir, 'trevo-found.png');
  const tfLabel = tf.type === 'agent' ? tf.name : `${tf.trade} demo`;
  const tfSub   = tf.type === 'agent' ? tf.tagline : tf.url || 'trevoadvisors.com/demos/';
  const tfFeats = tf.features || [];
  try {
    const buf = await render.renderTrevoFoundPost(tfLabel, tfSub, tfFeats.length ? tfFeats : ['Tap-to-call above the fold', 'Google reviews live', 'Service pages', 'Mobile-first', '48-hour build']);
    saveBuffer(buf, tfPath);
    imagePaths.trevo_found = [tfPath];
    console.log('Trevo found image rendered.');
  } catch (err) {
    console.warn(`Trevo found render failed: ${err.message}`);
    imagePaths.trevo_found = [];
  }

  // 4. reel — real vertical .mp4 (lib/reel.js + lib/canvas-render.js reel-frame
  // renderers), dispatched on the week's reel style (content.reelStyle, set by
  // lib/planner.js). Falls back to the storyboard frames if ffmpeg assembly fails.
  try {
    const style = content.reelStyle || 'card';
    const { images, video } = await renderReel(posts.reel, imageDir, style);
    imagePaths.reel = images;
    posts.reel.video = video;
    console.log(`Reel (${style}) rendered — ${images.length} frame(s)${video ? ' + reel.mp4' : ''}.`);
  } catch (err) {
    console.warn(`Reel render failed: ${err.message}`);
    imagePaths.reel = [];
    posts.reel.video = null;
  }

  const updatedContent = { ...content, imagePaths };
  store.savePost(updatedContent);

  const totalImages = Object.values(imagePaths).flat().length;
  console.log(`Design complete. ${totalImages} images saved to ${imageDir}.`);
  console.log(`Next: node agents/scheduler.js`);
}

main().catch(err => {
  console.error(`Designer failed: ${err.message}`);
  process.exit(1);
});
