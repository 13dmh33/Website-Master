'use strict';

// post-due.js — posts approved posts whose slot time has arrived, directly to
// Instagram via lib/instagram-publish.js. Adapted from Miley's proven module;
// operates on tatas/state.json.
//
// Runs on cron (tatas-post-due GitHub Action) at the weekday slot hours.
// Idempotent: only touches posts with status 'approved' and scheduledFor <=
// now, so extra runs are no-ops.
//
// Mirrored conventions:
//   - token health check before every posting run
//   - IG media ID recorded back to state.json (post→media attribution)
//   - failure: attempts++ and the post stays 'approved' for the next run;
//     after MAX_ATTEMPTS it becomes 'failed'
//   - anything overdue by more than STALE_HOURS becomes 'stale' and is NOT
//     posted — week-old content shouldn't quietly go out after an outage
//
// usage:
//   node scripts/post-due.js            # post everything due
//   node scripts/post-due.js --dry-run  # show what would post

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const state = require('../lib/state');
const ig    = require('../lib/instagram-publish');

const DRY_RUN      = process.argv.includes('--dry-run');
const MAX_ATTEMPTS = 3;
const STALE_HOURS  = 72;

const SOCIAL_BASE_URL = (process.env.TATAS_SOCIAL_BASE_URL || 'https://trevoadvisors.com').replace(/\/$/, '');

async function main() {
  const now = new Date();
  const current = state.load();
  const due = current.posts.filter(p =>
    p.status === 'approved' && new Date(p.scheduledFor) <= now
  );

  if (!due.length) {
    console.log('Nothing due. (Approved posts wait for their slot time.)');
    return;
  }

  if (!DRY_RUN && !ig.isConfigured()) {
    console.error('Instagram API not configured — set TATAS_IG_TOKEN + TATAS_IG_USER_ID.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    const health = await ig.checkTokenHealth();
    if (!health.ok) {
      console.error(`Instagram token health check FAILED: ${health.error}`);
      console.error('Token likely expired/revoked — run scripts/refresh-token.js or regenerate in the Meta dashboard.');
      process.exit(1);
    }
    console.log(`Token OK — posting as @${health.username}.`);
  }

  let posted = 0, failed = 0, stale = 0;

  for (const post of due) {
    const overdueHours = (now - new Date(post.scheduledFor)) / 36e5;

    if (overdueHours > STALE_HOURS) {
      console.warn(`  ⚠ ${post.id}: ${Math.round(overdueHours)}h overdue → marking stale (not posting).`);
      if (!DRY_RUN) state.updatePost(post.id, { status: 'stale' });
      stale++;
      continue;
    }

    const imageUrls = (post.publicImages || []).map(p => `${SOCIAL_BASE_URL}${p}`);
    console.log(`\n[${post.id}] due ${post.scheduledFor} · ${imageUrls.length} slide(s)`);

    if (!imageUrls.length) {
      console.error('  ✗ no hosted images (publicImages empty) — run publish-cards.js, then re-run.');
      if (!DRY_RUN) {
        const attempts = (post.attempts || 0) + 1;
        state.updatePost(post.id, {
          attempts, lastError: 'no publicImages',
          ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
        });
      }
      failed++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  → would publish ${imageUrls.length === 1 ? 'single image' : `${imageUrls.length}-slide carousel`}:`);
      imageUrls.forEach(u => console.log(`    ${u}`));
      continue;
    }

    try {
      const mediaId = await ig.publishPost({ imageUrls, caption: post.postText || post.caption || '' });
      state.updatePost(post.id, {
        status: 'posted',
        postedAt: new Date().toISOString(),
        igMediaId: mediaId,     // post→media attribution for a future analyst
        lastError: undefined,
      });
      console.log(`  ✓ posted — IG media ID: ${mediaId}`);
      posted++;
    } catch (err) {
      const attempts = (post.attempts || 0) + 1;
      state.updatePost(post.id, {
        attempts, lastError: err.message,
        ...(attempts >= MAX_ATTEMPTS ? { status: 'failed' } : {}),
      });
      if (attempts >= MAX_ATTEMPTS) {
        console.error(`  ✗ FAILED permanently after ${attempts} attempts: ${err.message}`);
      } else {
        console.error(`  ✗ failed (attempt ${attempts}/${MAX_ATTEMPTS}, will retry next run): ${err.message}`);
      }
      failed++;
    }
  }

  if (!DRY_RUN) {
    const s = state.load();
    s.last_post_run = new Date().toISOString();
    state.save(s);
  }

  console.log(`\nDone. ${posted} posted, ${failed} failed, ${stale} stale.`);
  if (failed) process.exit(1); // non-zero → the workflow's failure alert fires
}

main().catch(err => {
  console.error(`post-due failed: ${err.message}`);
  process.exit(1);
});
