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

async function renderSingle(post, imageDir, idx) {
  const paletteKey = paletteFor(post);
  const outPath = path.join(imageDir, `${idx + 1}-${post.slot}-${post.format}.png`);
  const hasPhoto = !!render.productImagePath(post.product);
  // selectTemplate (#11) — no-op (always 'v1Gradient') unless TEMPLATES_ACTIVE=true.
  const templateName = render.selectTemplate(post.format, { hasPhoto });
  try {
    let buf;
    if (post.contentType === 'trades_stat' && post.statNumber) {
      buf = await render.renderStatCard({
        statNumber:  post.statNumber,
        statContext: post.statContext || '',
        source:      post.statSource || '',
        paletteKey,
      });
    } else if (templateName === 'cleanCard') {
      buf = await render.renderCleanCard(post.hook, '', 0, 0);
    } else if (templateName === 'photoCard' && hasPhoto) {
      const photoBuffer = fs.readFileSync(render.productImagePath(post.product));
      buf = await render.renderPhotoCard(post.hook, photoBuffer, '— Riley, Techs4Tatas');
    } else {
      buf = await render.renderSingle({
        hook:       post.hook,
        sub:        '— Riley, Techs4Tatas',
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
    const images = post.format === 'carousel'
      ? await renderCarousel(post, imageDir, i)
      : await renderSingle(post, imageDir, i);
    post.images = images;
    total += images.length;
    console.log(`  ${post.slot} ${post.contentType} (${post.format}) — ${images.length} image(s).`);
  }

  store.savePost(content);
  console.log(`Design complete. ${total} images saved to ${imageDir}.`);
}

main().catch(err => {
  console.error(`Designer failed: ${err.message}`);
  process.exit(1);
});
