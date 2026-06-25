'use strict';

// push-queue.js — the APPROVAL step (Techs4Tatas / Miley).
// After Dave reviews the preview, this releases the queued week to Buffer.
// Each post is scheduled at its stored `scheduledFor` time (Buffer posts it
// later, at the slot) — it does NOT post immediately on approval.
//
// Buffer ingests each post's image FROM A PUBLIC URL when it receives the post,
// so the image must already be live on the linkpage host before scheduling.
// The flow is therefore two steps:
//   1. --stage : copy all queued images into linkpage/posts/ (no Buffer call),
//                then re-deploy the linkpage folder so the images go live.
//   2. (no flag): schedule to Buffer using those now-live image URLs.
//
// usage:
//   node scripts/push-queue.js --stage    # copy images into linkpage/posts/ to deploy
//   node scripts/push-queue.js --dry-run  # show what would be sent (no copy, no send)
//   node scripts/push-queue.js            # schedule all pending to Buffer

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store  = require('../lib/store');
const buffer = require('../lib/buffer');

const DRY_RUN = process.argv.includes('--dry-run');
const STAGE   = process.argv.includes('--stage');

async function main() {
  const pending = store.getPendingQueue();

  if (!pending.length) {
    console.log('No pending posts in queue. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending post(s) in queue.`);
  if (DRY_RUN) console.log('Dry run — nothing will be sent.\n');

  if (STAGE) {
    let staged = 0, skipped = 0;
    for (const post of pending) {
      const images = post.images || [];
      console.log(`\n[${post.slot} · ${post.contentType}] ${images.length} image(s)`);
      if (!images.length) { console.log('  (no images — text-only)'); continue; }
      try {
        const url = buffer.publishImage(images[0]);
        console.log(`  ✓ staged → ${url}`);
        staged++;
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
        skipped++;
      }
    }
    console.log(`\nStaged ${staged} image(s)${skipped ? `, ${skipped} skipped` : ''}.`);
    console.log('Next: re-deploy the linkpage/ folder (drag onto Netlify) so these URLs go live,');
    console.log('then run: node scripts/push-queue.js');
    return;
  }

  if (!DRY_RUN && !buffer.isConfigured()) {
    console.error('Buffer is not configured. Add BUFFER_ACCESS_TOKEN (GraphQL personal API key from developers.buffer.com) to .env.');
    process.exit(1);
  }

  let posted = 0, failed = 0;

  for (const post of pending) {
    const text = post.postText || post.caption || '';
    console.log(`\n[${post.slot} · ${post.contentType}] scheduled for: ${post.scheduledFor}`);
    console.log(`  text: ${text.slice(0, 90).replace(/\n/g, ' ')}...`);
    console.log(`  images: ${(post.images || []).length}`);

    if (DRY_RUN) { console.log('  → would schedule via Buffer (dry run)'); continue; }

    try {
      const result = await buffer.schedulePost({
        imagePaths:  post.images || [],
        caption:     text,
        scheduledAt: post.scheduledFor,   // preserved — posts at the slot, not now
      });
      store.markQueuePosted(post.file);
      console.log(`  ✓ scheduled — Buffer ID: ${result.updateId}`);
      posted++;
    } catch (err) {
      console.error(`  ✗ failed: ${err.message}`);
      failed++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\nDone. ${posted} scheduled, ${failed} failed.`);
    if (failed) console.log('Failed posts remain in the queue — fix and re-run.');
  }
}

main().catch(err => {
  console.error(`Push queue failed: ${err.message}`);
  process.exit(1);
});
