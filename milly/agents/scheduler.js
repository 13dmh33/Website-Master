'use strict';

// scheduler — posting agent
// runs Tuesday 6am MT after designer
// primary: Buffer API (auto-schedules 4 posts to Instagram)
// fallback: writes posts to /output/queue/ as JSON for manual publishing

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path      = require('path');
const store     = require('../lib/store');
const buffer    = require('../lib/buffer');
const abTracker = require('../lib/ab-tracker');
const { validateQueue } = require('../lib/brand-validator');

const TIMEZONE = process.env.TIMEZONE || 'America/Denver';
const SCHEDULE_STR = process.env.POST_SCHEDULE || 'TUE:07:00,THU:12:00,SAT:09:00,SUN:18:00,FRI:15:00';

// parse POST_SCHEDULE env var into a map of day → HH:MM
function parseSchedule() {
  const map = {};
  for (const entry of SCHEDULE_STR.split(',')) {
    const colonIdx = entry.indexOf(':');
    const day  = entry.slice(0, colonIdx).trim().toUpperCase();
    const time = entry.slice(colonIdx + 1).trim(); // preserves HH:MM
    map[day] = time;
  }
  return map;
}

// given a day abbreviation (MON, TUE, etc.) and HH:MM, find the next occurrence
// and return as an ISO UTC string
function nextOccurrence(dayAbbr, timeStr) {
  const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const [hour, minute] = timeStr.split(':').map(Number);
  const targetDay = DAY_MAP[dayAbbr];

  // build the date in Mountain Time by constructing it in UTC with the offset
  // MT is UTC-7 (MDT) or UTC-6 (MST); approximate with -7 for simplicity
  // for production accuracy, use a proper timezone library
  const now     = new Date();
  const nowDay  = now.getUTCDay();
  let daysAhead = (targetDay - nowDay + 7) % 7;
  if (daysAhead === 0 && (now.getUTCHours() + 7) >= hour) daysAhead = 7;

  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + daysAhead);
  target.setUTCHours(hour + 7, minute, 0, 0); // MT = UTC-7, so add 7 for UTC

  return target.toISOString();
}

// build the 4 post objects from content + image paths
//
// Any of posts.carousel/caption1/reevefound/reel can now be null — a per-post
// generation failure that had no evergreen fallback (see generator.js) skips
// that post rather than crashing the whole run. Each is included only when
// present, mirroring the existing null-guard already used for posts.story.
function buildPostObjects(content, schedule) {
  const { weekOf, posts, imagePaths } = content;
  const DAYS = ['TUE', 'THU', 'SAT', 'SUN'];

  const postDefs = [];

  if (posts.carousel) {
    postDefs.push({
      format:    'carousel',
      caption:   posts.carousel.caption,
      images:    (imagePaths && imagePaths.carousel) || [],
      scheduleDay: DAYS[0],
    });
  } else {
    console.warn('No carousel post this week (generation + evergreen fallback both unavailable) — skipping.');
  }

  if (posts.caption1) {
    // Enhancement B: pick A or B variant for caption alternating weekly
    const captionVariant = abTracker.getCurrentVariant();
    const captionBody    = captionVariant === 'B' && posts.caption1.variantB
      ? posts.caption1.variantB
      : posts.caption1.variantA || posts.caption1.body;
    abTracker.recordVariant(weekOf, captionVariant);
    console.log(`Caption variant this week: ${captionVariant}`);
    postDefs.push({
      format:    'caption',
      caption:   captionBody,
      images:    (imagePaths && imagePaths.caption1) || [],
      scheduleDay: DAYS[1],
    });
  } else {
    console.warn('No caption post this week (generation + evergreen fallback both unavailable) — skipping.');
  }

  if (posts.reevefound) {
    postDefs.push({
      format:    'reevefound',
      caption:   posts.reevefound.body,
      images:    (imagePaths && imagePaths.reevefound) || [],
      scheduleDay: DAYS[2],
    });
  } else {
    console.warn('No reeve-found post this week (generation + evergreen fallback both unavailable) — skipping.');
  }

  if (posts.reel) {
    postDefs.push({
      format:    'reel',
      caption:   posts.reel.script,
      images:    (imagePaths && imagePaths.reel) || [],
      scheduleDay: DAYS[3],
    });
  } else {
    console.warn('No reel post this week (generation failed, no evergreen fallback exists for this format) — skipping.');
  }

  // Story — vertical format, Buffer's classic API has no Stories endpoint,
  // so it's always manual-only and routes straight to the queue
  if (posts.story && imagePaths && imagePaths.story) {
    postDefs.push({
      format:      'story',
      caption:     posts.story.text,
      images:      imagePaths.story,
      scheduleDay: 'FRI',
      manualOnly:  true,
    });
  }

  return postDefs.map(def => ({
    weekOf,
    format:       def.format,
    images:       def.images,
    caption:      def.caption,
    manualOnly:   !!def.manualOnly,
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

  const schedule  = parseSchedule();
  const allPostObjects = buildPostObjects(content, schedule);

  console.log(`Scheduler running for week of ${content.weekOf}.`);
  console.log(`Buffer configured: ${buffer.isConfigured()}`);

  // Hard gate: brand-validator.js checks every post against
  // templates/brand-voice.json's rules before it reaches EITHER the manual
  // queue or a live Buffer post. Runs ahead of the Buffer-vs-queue branch on
  // purpose — a failing post must not go live even if Buffer happens to be
  // configured with FORCE_QUEUE unset. Mirrors Molly's identical wiring
  // (molly/agents/scheduler.js) — Milly was the only live-posting sibling
  // without this gate before now.
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

  // manual-only posts (e.g. Stories — Buffer's classic API has no Stories endpoint)
  // always go straight to the queue regardless of Buffer config
  const manualPosts     = postObjects.filter(p => p.manualOnly);
  const schedulablePosts = postObjects.filter(p => !p.manualOnly);

  for (const post of manualPosts) {
    const filePath = store.saveToQueue(post);
    console.log(`Saved ${post.format} → ${path.basename(filePath)} (scheduled for ${post.scheduledFor}) — manual-only, no Buffer Stories support.`);
  }

  if (buffer.isConfigured() && !forceQueue) {
    // primary path: schedule via Buffer → Instagram
    let successCount = 0;
    for (const post of schedulablePosts) {
      try {
        const result = await buffer.schedulePost({
          imagePaths:  post.images,
          caption:     post.caption,
          scheduledAt: post.scheduledFor,
        });
        store.updatePostStatus(post.weekOf, post.format, 'scheduled');
        console.log(`Scheduled ${post.format} for ${post.scheduledFor} — Buffer ID: ${result.updateId}`);
        successCount++;
      } catch (err) {
        console.warn(`Buffer schedule failed for ${post.format}: ${err.message}`);
        console.warn(`Saving ${post.format} to queue fallback.`);
        store.saveToQueue(post);
      }
    }
    if (successCount === schedulablePosts.length) {
      console.log(`${successCount} posts scheduled via Buffer.`);
    } else {
      console.log(`${successCount} posts scheduled via Buffer. ${schedulablePosts.length - successCount} saved to queue.`);
    }
  } else {
    // fallback path: write to /output/queue/
    for (const post of schedulablePosts) {
      const filePath = store.saveToQueue(post);
      console.log(`Saved ${post.format} → ${path.basename(filePath)} (scheduled for ${post.scheduledFor})`);
    }
    console.log(`Buffer not configured — ${schedulablePosts.length} posts saved to queue. Run: node scripts/push-queue.js`);
  }

  // generate HTML preview for Dave to review
  await generatePreview(postObjects, content.weekOf);

  // TODO: Twilio alert — add in Phase 2
}

// generate a browser-viewable HTML preview of the week's posts
async function generatePreview(postObjects, weekOf) {
  const fs   = require('fs');
  const path = require('path');

  const queueDir   = store.paths.queue;
  const previewPath = path.join(queueDir, `preview-${weekOf}.html`);
  store.ensureDir(queueDir);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Milly content preview — ${weekOf}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1   { color: #1DA884; margin-bottom: 0.25rem; }
    p.sub { color: #64748b; margin-top: 0; }
    .post { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; max-width: 680px; }
    .post h2  { color: #1DA884; margin-top: 0; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .post .time { color: #64748b; font-size: 0.85rem; margin-bottom: 1rem; }
    .post img   { max-width: 100%; border-radius: 8px; display: block; margin-bottom: 1rem; }
    .post pre   { white-space: pre-wrap; font-family: inherit; font-size: 0.9rem; line-height: 1.6; color: #cbd5e1; }
    .tag { display: inline-block; background: #0B1120; color: #1DA884; border-radius: 4px; padding: 2px 8px; font-size: 0.78rem; margin-right: 4px; }
  </style>
</head>
<body>
  <h1>Milly content preview</h1>
  <p class="sub">Week of ${weekOf} — ${postObjects.length} posts</p>
`;

  const FORMAT_LABELS = {
    carousel:   'Tuesday 7am — carousel',
    caption:    'Thursday 12pm — caption',
    reevefound: 'Saturday 9am — Reeve found this',
    reel:       'Sunday 6pm — reel',
    story:      'Friday 3pm — Story (manual post — Buffer has no Stories support)',
  };

  for (const post of postObjects) {
    const label = FORMAT_LABELS[post.format] || post.format;
    let imageHtml = '';

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
    ${imageHtml}
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
