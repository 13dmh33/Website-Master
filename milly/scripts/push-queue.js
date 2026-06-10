'use strict';

// manual queue publisher — run when PostPeer is not configured or temporarily down
// reads all pending posts from /output/queue/, posts them, marks as done
// usage: node scripts/push-queue.js [--dry-run]

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store    = require('../lib/store');
const postpeer = require('../lib/postpeer');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pending = store.getPendingQueue();

  if (!pending.length) {
    console.log('No pending posts in queue. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending post(s) in queue.`);
  if (DRY_RUN) console.log('Dry run — will not post, just show what would be sent.\n');

  if (!DRY_RUN && !postpeer.isConfigured()) {
    console.error('PostPeer is not configured. Add POSTPEER_API_KEY and POSTPEER_ACCOUNT_ID to .env.');
    process.exit(1);
  }

  let posted = 0;
  let failed = 0;

  for (const post of pending) {
    console.log(`\n[${post.format}] Scheduled for: ${post.scheduledFor}`);
    console.log(`Caption preview: ${(post.caption || '').slice(0, 80)}...`);
    console.log(`Images: ${(post.images || []).length} file(s)`);

    if (DRY_RUN) {
      console.log('→ Would post to PostPeer (dry run skipped)');
      continue;
    }

    try {
      const result = await postpeer.schedulePost({
        imagePaths:  post.images || [],
        caption:     post.caption,
        scheduledAt: post.scheduledFor,
      });
      store.markQueuePosted(post.file);
      console.log(`✓ Posted — PostPeer ID: ${result.postId}`);
      posted++;
    } catch (err) {
      console.error(`✗ Failed to post ${post.format}: ${err.message}`);
      failed++;
    }
  }

  if (!DRY_RUN) {
    console.log(`\nDone. ${posted} posted, ${failed} failed.`);
    if (failed > 0) {
      console.log('Failed posts remain in queue. Fix the error above and run again.');
    }
  }
}

main().catch(err => {
  console.error(`Push queue failed: ${err.message}`);
  process.exit(1);
});
