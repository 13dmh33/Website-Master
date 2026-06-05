'use strict';

// designer — image rendering agent for Molly
// runs after generator — renders PNG images using skia-canvas
// saves to output/images/[YYYY-MM-DD]/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs     = require('fs');
const path   = require('path');
const render = require('../lib/canvas-render');
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

  // 2. caption image — extract hook line
  const captionHook = (posts.caption1.variantA || posts.caption1.body || '').split('\n').find(l => l.trim().length > 10) || '';
  const caption1Path = path.join(imageDir, 'caption-1.png');
  await renderSingleImage(captionHook, '— Trevo', caption1Path, niches.caption || 'results');
  imagePaths.caption1 = [caption1Path];
  console.log('Caption image rendered.');

  // 3. trevo_found — extract hook line
  const tfHook  = (posts.trevo_found.hookLine || posts.trevo_found.body || '').split('\n')[0] || '';
  const tfPath  = path.join(imageDir, 'trevo-found.png');
  await renderSingleImage(tfHook, 'That\'s the build. — Trevo', tfPath, 'trevo_found');
  imagePaths.trevo_found = [tfPath];
  console.log('Trevo found image rendered.');

  // 4. reel hook image
  const reelHookPath = path.join(imageDir, 'reel-hook.png');
  await renderSingleImage(posts.reel.hookLine || '', '— Trevo', reelHookPath, niches.reel || 'reel');
  imagePaths.reel = [reelHookPath];
  console.log('Reel hook image rendered.');

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
