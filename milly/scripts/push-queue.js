'use strict';

// manual queue publisher — run when Buffer is not configured or temporarily down
// reads all pending posts from /output/queue/, posts them, marks as done
// usage: node scripts/push-queue.js [--dry-run]

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store  = require('../lib/store');
const buffer = require('../lib/buffer');
const { validateQueue } = require('../lib/brand-validator');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pending = store.getPendingQueue();

  if (!pending.length) {
    console.log('No pending posts in queue. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending post(s) in queue.`);
  if (DRY_RUN) console.log('Dry run — will not post, just show what would be sent.\n');

  // Hard gate: same brand-validator.js check scheduler.js already ran before
  // queuing — defense in depth, matching Molly's identical pattern, in case a
  // queue file was ever hand-edited after the first pass.
  const { passed: postable, rejected } = validateQueue(pending);
  if (rejected.length > 0) {
    console.warn(`Brand-validator rejected ${rejected.length}/${pending.length} queued post(s) — held back:`);
    for (const { post, failures } of rejected) {
      console.warn(`  ${post.format}: ${failures.join('; ')}`);
    }
  }
  if (!postable.length) {
    console.error('All queued posts failed brand validation. Nothing to post.');
    process.exit(1);
  }

  if (!DRY_RUN && !buffer.isConfigured()) {
    console.error('Buffer is not configured. Add BUFFER_ACCESS_TOKEN and BUFFER_INSTAGRAM_PROFILE_ID to .env.');
    process.exit(1);
  }

  let posted = 0;
  let failed = 0;

  for (const post of postable) {
    console.log(`\n[${post.format}] Scheduled for: ${post.scheduledFor}`);
    console.log(`Caption preview: ${(post.caption || '').slice(0, 80)}...`);
    console.log(`Images: ${(post.images || []).length} file(s)`);

    if (DRY_RUN) {
      console.log('→ Would post to Buffer (dry run skipped)');
      continue;
    }

    try {
      const result = await buffer.schedulePost({
        imagePaths:  post.images || [],
        caption:     post.caption,
        scheduledAt: post.scheduledFor,
      });
      store.markQueuePosted(post.file);
      console.log(`✓ Posted — Buffer ID: ${result.updateId}`);
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
