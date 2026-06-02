'use strict';

// designer — image rendering agent
// runs Monday 9am MT after generator
// renders PNG images for all 4 content pieces using skia-canvas
// saves to /output/images/[YYYY-MM-DD]/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const render = require('../lib/canvas-render');
const store  = require('../lib/store');

// save a buffer to a file, creating the directory if needed
function saveBuffer(buffer, filePath) {
  store.ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
}

// render one carousel slide with graceful fallback on failure
async function renderSlide(headline, body, slideNum, totalSlides, outPath) {
  try {
    const buf = await render.renderCarouselSlide(headline, body, slideNum, totalSlides);
    saveBuffer(buf, outPath);
    return true;
  } catch (err) {
    console.warn(`Slide ${slideNum} render failed (${err.message}) — using fallback.`);
    try {
      const fallback = await render.renderFallback(`${headline}\n\n${body}`);
      saveBuffer(fallback, outPath);
      return true;
    } catch (e2) {
      console.error(`Fallback render also failed for slide ${slideNum}: ${e2.message}`);
      return false;
    }
  }
}

// render a single-image post with graceful fallback
async function renderSingleImage(text, attribution, outPath) {
  try {
    const buf = await render.renderQuotePost(text, attribution);
    saveBuffer(buf, outPath);
    return true;
  } catch (err) {
    console.warn(`Single image render failed (${err.message}) — using fallback.`);
    try {
      const fallback = await render.renderFallback(`${text}\n\n${attribution || ''}`);
      saveBuffer(fallback, outPath);
      return true;
    } catch (e2) {
      console.error(`Fallback render failed: ${e2.message}`);
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

  const { weekOf, posts } = content;
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
    const ok      = await renderSlide(slide.headline, slide.body || '', i + 1, slides.length, outPath);
    if (ok) carouselPaths.push(outPath);
  }
  imagePaths.carousel = carouselPaths;
  console.log(`Carousel: ${carouselPaths.length}/${slides.length} slides rendered.`);

  // 2. caption-1 (pain-point) — extract hook line for image
  const captionHook = posts.caption1.body.split('\n').find(l => l.trim().length > 10) || posts.caption1.body.slice(0, 60);
  const caption1Path = path.join(imageDir, 'caption-1.png');
  await renderSingleImage(captionHook, '— Reeve', caption1Path);
  imagePaths.caption1 = [caption1Path];
  console.log('Caption-1 image rendered.');

  // 3. Reeve found — extract hook line
  const rfHook = posts.reevefound.body.split('\n').find(l => l.trim().length > 10) || posts.reevefound.body.slice(0, 60);
  const rf2Path = path.join(imageDir, 'caption-2-reeve-found.png');
  await renderSingleImage(rfHook, 'That\'s the job. — Reeve', rf2Path);
  imagePaths.reevefound = [rf2Path];
  console.log('Reeve found image rendered.');

  // 4. reel hook image (just the hook line as a bold quote-style image)
  const reelHookPath = path.join(imageDir, 'reel-hook.png');
  await renderSingleImage(posts.reel.hookLine, '— Reeve', reelHookPath);
  imagePaths.reel = [reelHookPath];
  console.log('Reel hook image rendered.');

  // save image paths back to the content file so scheduler can find them
  const updatedContent = { ...content, imagePaths };
  store.savePost(updatedContent);

  const totalImages = Object.values(imagePaths).flat().length;
  console.log(`Design complete. ${totalImages} images saved to ${imageDir}.`);
}

main().catch(err => {
  console.error(`Designer failed: ${err.message}`);
  process.exit(1);
});
