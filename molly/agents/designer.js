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

  // 3. trevo_found — site reveal card
  const tfTrade    = posts.trevo_found.trade || 'contractor';
  const tfCity     = posts.trevo_found.city  || 'your city';
  const tfBody     = posts.trevo_found.body  || '';
  // extract bullet features from body (lines starting with letters after the opening line)
  const tfFeatures = tfBody.split('\n').filter(l => l.trim().length > 10 && !l.includes('Trevo just built') && !l.includes("That's the build") && !l.includes('DM us')).slice(0, 5);
  const tfPath     = path.join(imageDir, 'trevo-found.png');
  try {
    const buf = await render.renderTrevoFoundPost(tfTrade, tfCity, tfFeatures.length ? tfFeatures : ['Fast mobile site', 'Tap-to-call button', 'Google reviews integration', 'Service pages', '48-hour build']);
    saveBuffer(buf, tfPath);
    imagePaths.trevo_found = [tfPath];
    console.log('Trevo found image rendered.');
  } catch (err) {
    console.warn(`Trevo found render failed: ${err.message}`);
    imagePaths.trevo_found = [];
  }

  // 4. reel hook image — bold thumbnail
  const reelHookPath = path.join(imageDir, 'reel-hook.png');
  try {
    const buf = await render.renderReelHook(posts.reel.hookLine || '', niches.reel || 'reel');
    saveBuffer(buf, reelHookPath);
    imagePaths.reel = [reelHookPath];
    console.log('Reel hook image rendered.');
  } catch (err) {
    console.warn(`Reel render failed: ${err.message}`);
    imagePaths.reel = [];
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
