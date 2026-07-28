'use strict';

// scheduler — posting agent for Molly
// primary: Buffer API (auto-schedules 4 posts to Instagram)
// fallback: writes posts to output/queue/ as JSON for manual publishing

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path       = require('path');
const store      = require('../lib/store');
const buffer     = require('../lib/buffer');
const abTracker  = require('../lib/ab-tracker');
const { validateQueue } = require('../lib/brand-validator');

const SCHEDULE_STR = process.env.POST_SCHEDULE || 'TUE:07:00,THU:12:00,SAT:09:00,SUN:18:00';

function parseSchedule() {
  const map = {};
  for (const entry of SCHEDULE_STR.split(',')) {
    const colonIdx = entry.indexOf(':');
    const day  = entry.slice(0, colonIdx).trim().toUpperCase();
    const time = entry.slice(colonIdx + 1).trim();
    map[day] = time;
  }
  return map;
}

function nextOccurrence(dayAbbr, timeStr) {
  const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const [hour, minute] = timeStr.split(':').map(Number);
  const targetDay = DAY_MAP[dayAbbr];

  const now     = new Date();
  const nowDay  = now.getUTCDay();
  let daysAhead = (targetDay - nowDay + 7) % 7;
  if (daysAhead === 0 && (now.getUTCHours() + 7) >= hour) daysAhead = 7;

  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + daysAhead);
  target.setUTCHours(hour + 7, minute, 0, 0); // MT = UTC-7
  return target.toISOString();
}

function buildPostObjects(content, schedule) {
  const { weekOf, posts, imagePaths } = content;
  const DAYS = ['TUE', 'THU', 'SAT', 'SUN'];

  const captionVariant = abTracker.getCurrentVariant();
  const captionBody    = captionVariant === 'B' && posts.caption1.variantB
    ? posts.caption1.variantB
    : posts.caption1.variantA || posts.caption1.body;
  abTracker.recordVariant(weekOf, captionVariant);
  console.log(`Caption variant this week: ${captionVariant}`);

  const postDefs = [
    {
      format:      'carousel',
      caption:     posts.carousel.caption,
      images:      (imagePaths && imagePaths.carousel) || [],
      scheduleDay: DAYS[0],
    },
    {
      format:      'caption',
      caption:     captionBody,
      images:      (imagePaths && imagePaths.caption1) || [],
      scheduleDay: DAYS[1],
    },
    {
      format:      'trevo_found',
      caption:     posts.trevo_found.body,
      images:      (imagePaths && imagePaths.trevo_found) || [],
      scheduleDay: DAYS[2],
    },
    {
      format:      'reel',
      caption:     posts.reel.caption || posts.reel.hookLine,
      images:      (imagePaths && imagePaths.reel) || [],
      video:       posts.reel.video || null,
      hook:        posts.reel.hook,
      body:        posts.reel.body,
      cta:         posts.reel.cta,
      scheduleDay: DAYS[3],
    },
  ];

  return postDefs.map(def => ({
    weekOf,
    format:       def.format,
    images:       def.images,
    video:        def.video || null,
    hook:         def.hook,
    body:         def.body,
    cta:          def.cta,
    caption:      def.caption,
    scheduledFor: nextOccurrence(def.scheduleDay, schedule[def.scheduleDay] || '09:00'),
    status:       'pending',
  }));
}

async function main() {
  const content = store.getLatestContent();
  if (!content) {
    console.error('No generated content found. Run node agents/designer.js first.');
    process.exit(1);
  }

  const schedule       = parseSchedule();
  const allPostObjects = buildPostObjects(content, schedule);

  console.log(`Scheduler running for week of ${content.weekOf}.`);
  console.log(`Buffer configured: ${buffer.isConfigured()}`);

  // Hard gate: brand-validator.js checks every post against molly/CLAUDE.md's
  // rules before it reaches EITHER the review queue or a live Buffer post.
  // Runs ahead of the Buffer-vs-queue branch below on purpose — a failing
  // post must not go live even if Buffer happens to be configured with
  // FORCE_QUEUE unset.
  const { passed: postObjects, rejected } = validateQueue(allPostObjects);
  if (rejected.length > 0) {
    console.warn(`Brand-validator rejected ${rejected.length}/${allPostObjects.length} post(s) — held back, not queued or posted:`);
    for (const { post, failures } of rejected) {
      console.warn(`  ${post.format}: ${failures.join('; ')}`);
    }
  }
  if (postObjects.length === 0) {
    console.error('All posts failed brand validation. Nothing to schedule this run.');
    return;
  }

  const forceQueue = process.env.FORCE_QUEUE === '1';

  if (buffer.isConfigured() && !forceQueue) {
    let successCount = 0;
    for (const post of postObjects) {
      try {
        const result = await buffer.schedulePost({
          imagePaths:  post.images,
          videoPath:   post.video,
          caption:     post.caption,
          scheduledAt: post.scheduledFor,
        });
        store.updatePostStatus(post.weekOf, post.format, 'scheduled');
        console.log(`Scheduled ${post.format} for ${post.scheduledFor} — Buffer ID: ${result.updateId}`);
        successCount++;
      } catch (err) {
        console.warn(`Buffer schedule failed for ${post.format}: ${err.message}`);
        store.saveToQueue(post);
      }
    }
    console.log(`${successCount}/${postObjects.length} posts scheduled via Buffer.`);
  } else {
    for (const post of postObjects) {
      const filePath = store.saveToQueue(post);
      console.log(`Saved ${post.format} → ${path.basename(filePath)} (scheduled for ${post.scheduledFor})`);
    }
    console.log(`Buffer not configured — 4 posts saved to queue. Run: node scripts/push-queue.js`);
  }

  await generatePreview(postObjects, content.weekOf);
}

async function generatePreview(postObjects, weekOf) {
  const fs   = require('fs');
  const path = require('path');

  const queueDir    = store.paths.queue;
  const previewPath = path.join(queueDir, `preview-${weekOf}.html`);
  store.ensureDir(queueDir);

  const FORMAT_LABELS = {
    carousel:    'Tuesday 7am — carousel',
    caption:     'Thursday 12pm — caption',
    trevo_found: 'Saturday 9am — Trevo built this',
    reel:        'Sunday 6pm — reel',
  };

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Molly content preview — ${weekOf}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0A1228; color: #e2e8f0; padding: 2rem; }
    h1   { color: #00C8AF; margin-bottom: 0.25rem; }
    p.sub { color: #8BA8C4; margin-top: 0; }
    .post { background: #111b30; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; max-width: 680px; }
    .post h2  { color: #00C8AF; margin-top: 0; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .post .time { color: #8BA8C4; font-size: 0.85rem; margin-bottom: 1rem; }
    .post img   { max-width: 100%; border-radius: 8px; display: block; margin-bottom: 1rem; }
    .post video.reel { width: 280px; max-width: 100%; border-radius: 12px; display: block; margin-bottom: .75rem; background: #000; border: 1px solid #1e293b; }
    .post pre   { white-space: pre-wrap; font-family: inherit; font-size: 0.9rem; line-height: 1.6; color: #cbd5e1; }
  </style>
</head>
<body>
  <h1>Molly content preview</h1>
  <p class="sub">Week of ${weekOf} — ${postObjects.length} posts — Trevo Advisors</p>
`;

  for (const post of postObjects) {
    const label     = FORMAT_LABELS[post.format] || post.format;
    let videoHtml   = '';
    if (post.video && fs.existsSync(post.video)) {
      const rel = path.relative(queueDir, post.video).split(path.sep).join('/');
      videoHtml = `<video class="reel" controls muted loop playsinline preload="metadata" src="${escapeHtml(rel)}"></video>`;
    }
    let imageHtml   = '';
    if (post.images && post.images.length) {
      for (const imgPath of post.images) {
        if (fs.existsSync(imgPath)) {
          const b64 = fs.readFileSync(imgPath).toString('base64');
          imageHtml += `<img src="data:image/png;base64,${b64}" alt="${post.format} image" />\n`;
        }
      }
    }
    html += `
  <div class="post">
    <h2>${label}</h2>
    <div class="time">Scheduled for: ${post.scheduledFor}</div>
    ${videoHtml}
    ${videoHtml ? '' : imageHtml}
    <pre>${escapeHtml(post.caption)}</pre>
  </div>`;
  }

  html += `\n</body>\n</html>`;
  fs.writeFileSync(previewPath, html, 'utf8');
  console.log(`Preview saved: ${previewPath}`);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

main().catch(err => {
  console.error(`Scheduler failed: ${err.message}`);
  process.exit(1);
});
