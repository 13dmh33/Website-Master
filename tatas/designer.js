'use strict';

// designer.js — renders every pending post's slides to 1080x1080 PNGs.
// Output: tatas/output/images/{weekOf}/{postId}-slide-NN.png
// Writes the image paths back onto each post in state.json (additive).
//
// usage:
//   node designer.js                  # render all pending posts missing images
//   node designer.js --week 2026-07-13
//   node designer.js --force          # re-render even if images already recorded

const fs   = require('fs');
const path = require('path');
const state  = require('./lib/state');
const render = require('./lib/render-cards');

const FORCE = process.argv.includes('--force');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  const current = state.load();
  const weekOf  = argValue('--week');

  const targets = current.posts.filter(p =>
    p.status === 'pending' &&
    (!weekOf || p.weekOf === weekOf) &&
    (FORCE || !(p.images && p.images.length))
  );

  if (!targets.length) {
    console.log('Nothing to render — no pending posts missing images.');
    return;
  }

  console.log(`Designer: rendering ${targets.length} carousel(s).`);
  for (const post of targets) {
    const imageDir = path.join(__dirname, 'output', 'images', post.weekOf);
    fs.mkdirSync(imageDir, { recursive: true });

    const buffers = await render.renderCarousel(post.slides);
    const images = [];
    for (let i = 0; i < buffers.length; i++) {
      const outPath = path.join(imageDir, `${post.id}-slide-${String(i + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(outPath, buffers[i]);
      images.push(path.relative(__dirname, outPath)); // tatas-relative — survives different checkouts
    }
    state.updatePost(post.id, { images });
    console.log(`  ✓ ${post.slot} ${post.topicKey}: ${images.length} slides → output/images/${post.weekOf}/`);
  }
  console.log('Done. Next: node scripts/publish-cards.js');
}

main().catch(err => {
  console.error(`designer failed: ${err.message}`);
  process.exit(1);
});
