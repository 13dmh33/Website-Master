'use strict';

// post-due.js — posts approved queue items whose slot time has arrived,
// directly to Instagram via the Graph API (lib/instagram-publish.js).
//
// Runs on cron (miley-post-due GitHub Action) a few times a day around the
// slot hours. Idempotent: only touches records with status 'approved' and
// scheduledFor <= now, so extra runs are no-ops. A run that finds nothing due
// exits quietly.
//
// Lifecycle: pending → approved (approve-week.js) → posted (here)
//   - failure: attempts++ and the record stays 'approved' for the next run;
//     after MAX_ATTEMPTS it becomes 'failed' (visible in approve-week --list).
//   - anything overdue by more than STALE_HOURS becomes 'stale' and is NOT
//     posted — week-old content shouldn't quietly go out after an outage.
//
// usage:
//   node scripts/post-due.js            # post everything due
//   node scripts/post-due.js --dry-run  # show what would post

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const store = require('../lib/store');
const ig    = require('../lib/instagram-publish');

const DRY_RUN      = process.argv.includes('--dry-run');
const MAX_ATTEMPTS = 3;
const STALE_HOURS  = 72;

// where the hosted cards live — publicImages paths are appended to this
const SOCIAL_BASE_URL = (process.env.SOCIAL_BASE_URL || 'https://trevoadvisors.com').replace(/\/$/, '');

function loadQueueRecords() {
  const queueDir = store.paths.queue;
  if (!fs.existsSync(queueDir)) return [];
  return fs.readdirSync(queueDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('preview-'))
    .sort()
    .map(f => {
      const filePath = path.join(queueDir, f);
      return { file: f, filePath, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    });
}

function save(rec) {
  fs.writeFileSync(rec.filePath, JSON.stringify(rec.data, null, 2), 'utf8');
}

async function main() {
  const now = new Date();
  const due = loadQueueRecords().filter(r =>
    r.data.status === 'approved' && new Date(r.data.scheduledFor) <= now
  );

  if (!due.length) {
    console.log('Nothing due. (Approved posts wait for their slot time.)');
    return;
  }

  if (!DRY_RUN && !ig.isConfigured()) {
    console.error('Instagram Graph API not configured — set INSTAGRAM_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ACCOUNT_ID.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    const health = await ig.checkTokenHealth();
    if (!health.ok) {
      console.error(`Instagram token health check FAILED: ${health.error}`);
      console.error('Token likely expired/revoked — regenerate a long-lived token and update the secret.');
      process.exit(1);
    }
    console.log(`Token OK — posting as @${health.username}.`);
  }

  let posted = 0, failed = 0, stale = 0;

  for (const rec of due) {
    const slotName = rec.data.slot || rec.file;
    const overdueHours = (now - new Date(rec.data.scheduledFor)) / 36e5;

    if (overdueHours > STALE_HOURS) {
      console.warn(`  ⚠ ${slotName}: ${Math.round(overdueHours)}h overdue → marking stale (not posting).`);
      if (!DRY_RUN) { rec.data.status = 'stale'; save(rec); }
      stale++;
      continue;
    }

    const imageUrls = (rec.data.publicImages || []).map(p => `${SOCIAL_BASE_URL}${p}`);
    console.log(`\n[${slotName}] due ${rec.data.scheduledFor} · ${imageUrls.length} image(s)`);

    if (!imageUrls.length) {
      console.error(`  ✗ no hosted images (publicImages empty) — run publish-cards.js, then re-run.`);
      if (!DRY_RUN) {
        rec.data.attempts  = (rec.data.attempts || 0) + 1;
        rec.data.lastError = 'no publicImages';
        if (rec.data.attempts >= MAX_ATTEMPTS) rec.data.status = 'failed';
        save(rec);
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
      const mediaId = await ig.publishPost({ imageUrls, caption: rec.data.postText || rec.data.caption || '' });
      rec.data.status    = 'posted';
      rec.data.postedAt  = new Date().toISOString();
      rec.data.igMediaId = mediaId;   // Analyst uses this for exact post→metrics attribution
      delete rec.data.lastError;
      save(rec);
      console.log(`  ✓ posted — IG media ID: ${mediaId}`);
      posted++;
    } catch (err) {
      rec.data.attempts  = (rec.data.attempts || 0) + 1;
      rec.data.lastError = err.message;
      if (rec.data.attempts >= MAX_ATTEMPTS) {
        rec.data.status = 'failed';
        console.error(`  ✗ FAILED permanently after ${rec.data.attempts} attempts: ${err.message}`);
      } else {
        console.error(`  ✗ failed (attempt ${rec.data.attempts}/${MAX_ATTEMPTS}, will retry next run): ${err.message}`);
      }
      save(rec);
      failed++;
    }
  }

  console.log(`\nDone. ${posted} posted, ${failed} failed, ${stale} stale.`);
  if (failed) process.exit(1); // non-zero → the workflow's failure alert fires
}

main().catch(err => {
  console.error(`post-due failed: ${err.message}`);
  process.exit(1);
});
