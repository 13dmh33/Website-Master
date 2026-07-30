'use strict';

// designer — image rendering agent
// runs Monday 9am MT after generator
// renders PNG images for all 4 content pieces using skia-canvas
// saves to /output/images/[YYYY-MM-DD]/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const render    = require('../lib/canvas-render');
const store     = require('../lib/store');
const abTracker = require('../lib/ab-tracker');

// save a buffer to a file, creating the directory if needed
function saveBuffer(buffer, filePath) {
  store.ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

// render one carousel slide with graceful fallback on failure
async function renderSlide(headline, body, slideNum, totalSlides, outPath, niche = 'booking', variant = 'A') {
  try {
    const buf = await render.renderCarouselSlide(headline, body, slideNum, totalSlides, niche, variant);
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

// render a single-image post with graceful fallback
async function renderSingleImage(text, attribution, outPath, niche = 'mindset', variant = 'A') {
  try {
    const buf = await render.renderQuotePost(text, attribution, niche, variant);
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

// render a vertical Story image with graceful fallback
async function renderStoryImage(text, outPath, niche = 'mindset', variant = 'A') {
  try {
    const buf = await render.renderStorySlide(text, niche, null, variant);
    saveBuffer(buf, outPath);
    return true;
  } catch (err) {
    console.warn(`Story render failed (${err.message}) — using fallback.`);
    try {
      const fallback = await render.renderFallback(text, niche);
      saveBuffer(fallback, outPath);
      return true;
    } catch (e2) {
      console.error(`Story fallback render also failed: ${e2.message}`);
      return false;
    }
  }
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

  // A/B visual design test — alternates weekly, independent of the caption A/B test
  const imageVariant = abTracker.getCurrentImageVariant();

  console.log(`Rendering images for week of ${weekOf}.`);
  console.log(`Output directory: ${imageDir}`);
  console.log(`Design variant this week: ${imageVariant}`);

  const imagePaths = {};

  // Each block below is now null-guarded — a per-post generation failure with
  // no evergreen fallback (see generator.js) leaves that post null, and the
  // week should still render images for whichever posts did succeed, mirroring
  // the null-guard already used for posts.story.

  // 1. carousel slides
  if (posts.carousel) {
    const { slides } = posts.carousel;
    const carouselPaths = [];
    console.log(`Rendering ${slides.length} carousel slides...`);
    for (let i = 0; i < slides.length; i++) {
      const slide   = slides[i];
      const outPath = path.join(imageDir, `carousel-slide-0${i + 1}.png`);
      const ok      = await renderSlide(slide.headline, slide.body || '', i + 1, slides.length, outPath, 'carousel', imageVariant);
      if (ok) carouselPaths.push(outPath);
    }
    imagePaths.carousel = carouselPaths;
    console.log(`Carousel: ${carouselPaths.length}/${slides.length} slides rendered.`);
  } else {
    console.warn('No carousel post this week — skipping carousel images.');
  }

  // 2. caption-1 (pain-point) — extract hook line for image
  if (posts.caption1) {
    const captionHook = posts.caption1.body.split('\n').find(l => l.trim().length > 10) || posts.caption1.body.slice(0, 60);
    const caption1Path = path.join(imageDir, 'caption-1.png');
    await renderSingleImage(captionHook, '— Reeve', caption1Path, niches.caption || 'mindset', imageVariant);
    imagePaths.caption1 = [caption1Path];
    console.log('Caption-1 image rendered.');
  } else {
    console.warn('No caption post this week — skipping caption-1 image.');
  }

  // 3. Reeve found — extract hook line
  if (posts.reevefound) {
    const rfHook = posts.reevefound.body.split('\n').find(l => l.trim().length > 10) || posts.reevefound.body.slice(0, 60);
    const rf2Path = path.join(imageDir, 'caption-2-reeve-found.png');
    await renderSingleImage(rfHook, 'That\'s the job. — Reeve', rf2Path, 'reevefound', imageVariant);
    imagePaths.reevefound = [rf2Path];
    console.log('Reeve found image rendered.');
  } else {
    console.warn('No reeve-found post this week — skipping reeve-found image.');
  }

  // 4. reel hook image (just the hook line as a bold quote-style image)
  if (posts.reel) {
    const reelHookPath = path.join(imageDir, 'reel-hook.png');
    await renderSingleImage(posts.reel.hookLine, '— Reeve', reelHookPath, niches.reel || 'reel', imageVariant);
    imagePaths.reel = [reelHookPath];
    console.log('Reel hook image rendered.');
  } else {
    console.warn('No reel post this week — skipping reel image.');
  }

  // 5. Story — vertical 1080x1920, only rendered if generator produced one
  if (posts.story) {
    const storyPath = path.join(imageDir, 'story.png');
    await renderStoryImage(posts.story.text, storyPath, posts.story.niche || 'mindset', imageVariant);
    imagePaths.story = [storyPath];
    console.log('Story image rendered.');
  }

  abTracker.recordImageVariant(weekOf, imageVariant);

  // save image paths back to the content file so scheduler can find them
  const updatedContent = { ...content, imagePaths, imageVariant };
  store.savePost(updatedContent);

  const totalImages = Object.values(imagePaths).flat().length;
  console.log(`Design complete. ${totalImages} images saved to ${imageDir}.`);
}

main().catch(err => {
  console.error(`Designer failed: ${err.message}`);
  process.exit(1);
});
