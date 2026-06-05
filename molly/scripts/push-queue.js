'use strict';

// push-queue — manually push queued posts to Buffer
// use when scheduler ran in fallback mode (Buffer not configured at schedule time)
// or to push a specific post on demand

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store  = require('../lib/store');
const buffer = require('../lib/buffer');

async function main() {
  if (!buffer.isConfigured()) {
    console.error('BUFFER_ACCESS_TOKEN not set. Get one at buffer.com/developers.');
    process.exit(1);
  }

  const pending = store.getPendingQueue();
  if (!pending.length) {
    console.log('No pending posts in queue.');
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
