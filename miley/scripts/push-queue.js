'use strict';

// push-queue.js — the APPROVAL step (Techs4Tatas / Miley).
// After Dave reviews the preview, this releases the queued week to Buffer.
// Each post is scheduled at its stored `scheduledFor` time (Buffer posts it
// later, at the slot) — it does NOT post immediately on approval.
//
// usage:
//   node scripts/push-queue.js            # post all pending to Buffer
//   node scripts/push-queue.js --dry-run  # show what would be sent

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store  = require('../lib/store');
const buffer = require('../lib/buffer');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pending = store.getPendingQueue();

  if (!pending.length) {
    console.log('No pending posts in queue. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending post(s) in queue.`);
  if (DRY_RUN) console.log('Dry run — nothing will be sent.\n');

  if (!DRY_RUN && !buffer.isConfigured()) {
    console.error('Buffer is not configured. Add BUFFER_ACCESS_TOKEN (classic token, NOT OIDC) to .env.');
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
