'use strict';

// push-queue — manually push queued posts to Buffer
// use when scheduler ran in fallback mode (Buffer not configured at schedule time)
// or to push a specific post on demand

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store  = require('../lib/store');
const buffer = require('../lib/buffer');
const { validateQueue } = require('../lib/brand-validator');

async function main() {
  if (!buffer.isConfigured()) {
    console.error('BUFFER_ACCESS_TOKEN not set. Get one at buffer.com/developers.');
    process.exit(1);
  }

  const queued = store.getPendingQueue();
  if (!queued.length) {
    console.log('No pending posts in queue.');
    process.exit(0);
  }

  // Defense in depth: scheduler.js already gates before queueing, but this
  // is the last stop before a live Buffer call, so it checks again — in
  // case a queue file was ever written or hand-edited by another path.
  const { passed: pending, rejected } = validateQueue(queued);
  if (rejected.length > 0) {
    console.warn(`Brand-validator rejected ${rejected.length}/${queued.length} queued post(s) — NOT pushed to Buffer:`);
    for (const { post, failures } of rejected) {
      console.warn(`  ${post.format}: ${failures.join('; ')}`);
    }
  }
  if (!pending.length) {
    console.log('All queued posts failed brand validation. Nothing pushed.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending post(s) in queue.\n`);

  let pushed = 0;
  for (const post of pending) {
    console.log(`Pushing: ${post.format} (scheduled for ${post.scheduledFor})`);
    try {
      const result = await buffer.schedulePost({
        imagePaths:  post.images || [],
        caption:     post.caption,
        scheduledAt: post.scheduledFor,
      });
      store.markQueuePosted(post.file);
      store.updatePostStatus(post.weekOf, post.format, 'scheduled');
      console.log(`  ✓ Pushed ${post.format} — Buffer ID: ${result.updateId}`);
      pushed++;
    } catch (err) {
      console.error(`  ✗ Failed to push ${post.format}: ${err.message}`);
    }
  }

  console.log(`\n${pushed}/${pending.length} posts pushed to Buffer.`);
}

main().catch(err => {
  console.error(`push-queue failed: ${err.message}`);
  process.exit(1);
});
