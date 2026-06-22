'use strict';

// scheduler — posting agent (Techs4Tatas / Miley)
// runs after designer. Review-first by design: with FORCE_QUEUE=1 (standing
// setting per docs/review-workflow.md) it writes every post to output/queue/
// and builds a browser preview. Nothing reaches Instagram until Dave approves
// by running scripts/push-queue.js, which posts each at its scheduled time.
//
// Posts are scheduled for the FOLLOWING week's slots (content is generated on
// Thursday for the week after, giving a Thu-Sun review window).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path      = require('path');
const fs        = require('fs');
const store     = require('../lib/store');
const buffer    = require('../lib/buffer');
const abTracker = require('../lib/ab-tracker');

const DAY_IDX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

// next week's occurrence of dayAbbr at HH:MM (Mountain Time ≈ UTC-6), as ISO UTC
function nextWeekOccurrence(dayAbbr, time) {
  const now = new Date();
  const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
  const daysToNextMonday = ((1 - dow + 7) % 7) || 7;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysToNextMonday);
  nextMonday.setUTCHours(0, 0, 0, 0);

  const d = new Date(nextMonday);
  d.setUTCDate(nextMonday.getUTCDate() + (DAY_IDX[dayAbbr] || 0));
  const [h, m] = (time || '12:00').split(':').map(Number);
  d.setUTCHours(h + 6, m, 0, 0); // MT(-6) → UTC
  return d.toISOString();
}

// build the full text that actually posts: clean caption + hashtag block at end
function buildPostText(post) {
  const tags = (post.hashtags || []).join(' ');
  return tags ? `${post.caption}\n\n${tags}` : post.caption;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const content = store.getLatestContent();
  if (!content || !content.posts) {
    console.error('No generated content found. Run node agents/generator.js (then designer.js) first.');
    process.exit(1);
  }

  const { weekOf, posts, campaignMode } = content;
  const forceQueue = process.env.FORCE_QUEUE === '1';
  const useBuffer  = buffer.isConfigured() && !forceQueue;

  console.log(`Scheduler running for week of ${weekOf} (mode: ${campaignMode}, ${posts.length} posts).`);
  console.log(`FORCE_QUEUE=${forceQueue ? '1' : '0'} · Buffer configured: ${buffer.isConfigured()} → ${useBuffer ? 'scheduling via Buffer' : 'review queue only'}`);

  // A/B caption testing: alternate the whole week between hook variant A and B
  // (each Claude-generated post carries both; evergreen posts have no real B).
  const captionVariant = abTracker.getCurrentVariant();
  abTracker.recordVariant(weekOf, captionVariant);
  console.log(`Caption variant this week: ${captionVariant}`);

  const queued = [];
  for (const post of posts) {
    const scheduledFor = nextWeekOccurrence(post.day, post.time);
    const caption = (captionVariant === 'B' && post.captionVariantB) ? post.captionVariantB : post.caption;
    const record = {
      weekOf,
      slot:        post.slot,
      day:         post.day,
      time:        post.time,
      format:      post.format,
      contentType: post.contentType,
      product:     post.product || null,
      isOctober:   post.isOctober,
      scheduledFor,
      caption,
      captionVariant,
      hashtags:    post.hashtags || [],
      postText:    buildPostText({ ...post, caption }),
      images:      post.images || [],
      suggested_visual: post.suggested_visual || '',
      extra:       post.extra || '',
      status:      'pending',
    };

    if (useBuffer) {
      try {
        const result = await buffer.schedulePost({ imagePaths: record.images, caption: record.postText, scheduledAt: scheduledFor });
        record.status = 'scheduled';
        record.bufferId = result.updateId;
        console.log(`  ${post.slot} ${post.contentType} → Buffer ${result.updateId} for ${scheduledFor}`);
      } catch (err) {
        console.warn(`  ${post.slot} Buffer failed (${err.message}) — saving to queue.`);
        store.saveToQueue(record);
      }
    } else {
      store.saveToQueue(record);
    }
    queued.push(record);
  }

  await generatePreview(queued, weekOf, campaignMode);

  if (useBuffer) console.log(`Done — ${queued.length} posts scheduled via Buffer.`);
  else console.log(`Done — ${queued.length} posts saved to queue. Review preview, then run: node scripts/push-queue.js`);
}

// browser-viewable preview of the week (Techs4Tatas pink/charcoal theme)
async function generatePreview(records, weekOf, campaignMode) {
  const queueDir = store.paths.queue;
  store.ensureDir(queueDir);
  const previewPath = path.join(queueDir, `preview-${weekOf}.html`);

  const cards = records.map(r => {
    let imgs = '';
    for (const imgPath of (r.images || [])) {
      if (fs.existsSync(imgPath)) {
        const b64 = fs.readFileSync(imgPath).toString('base64');
        imgs += `<img src="data:image/png;base64,${b64}" alt="${r.slot}" />`;
      }
    }
    const extra = r.extra ? `<div class="extra"><span class="lbl">slides / reel script</span><pre>${escapeHtml(r.extra)}</pre></div>` : '';
    const vis   = r.suggested_visual ? `<div class="vis">📷 ${escapeHtml(r.suggested_visual)}</div>` : '';
    return `
    <div class="post">
      <h2>${r.day} ${r.time} · ${r.contentType} <span class="fmt">${r.format}</span>${r.product ? ` · <span class="prod">${r.product}</span>` : ''}</h2>
      <div class="time">scheduled: ${r.scheduledFor}</div>
      ${imgs}
      ${vis}
      <pre class="cap">${escapeHtml(r.postText)}</pre>
      ${extra}
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Techs4Tatas — week of ${weekOf}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#1A1A1D; color:#F7F4F0; padding:2rem; }
  h1 { color:#FF2E88; margin-bottom:.2rem; }
  p.sub { color:#FFB3D1; margin-top:0; }
  .post { background:#232327; border:1px solid #333; border-radius:14px; padding:1.5rem; margin-bottom:1.75rem; max-width:680px; }
  .post h2 { color:#FF2E88; margin:0 0 .25rem; font-size:1rem; text-transform:uppercase; letter-spacing:.04em; }
  .fmt { color:#FFC400; font-size:.8rem; }
  .prod { color:#FFB3D1; font-size:.8rem; }
  .time { color:#8a8a90; font-size:.8rem; margin-bottom:1rem; }
  .post img { max-width:100%; border-radius:10px; display:block; margin-bottom:.75rem; }
  .vis { color:#FFB3D1; font-size:.85rem; margin:.5rem 0; }
  pre.cap { white-space:pre-wrap; font-family:inherit; font-size:.95rem; line-height:1.6; color:#F7F4F0; background:#1A1A1D; padding:1rem; border-radius:8px; }
  .extra { margin-top:.75rem; } .extra .lbl { color:#FFC400; font-size:.75rem; text-transform:uppercase; }
  .extra pre { white-space:pre-wrap; font-family:inherit; font-size:.85rem; color:#cfcfd4; background:#1A1A1D; padding:.75rem; border-radius:8px; }
</style></head><body>
  <h1>Techs4Tatas — content preview</h1>
  <p class="sub">Week of ${weekOf} · ${campaignMode} mode · ${records.length} posts · hashtags shown appended to caption</p>
  ${cards}
</body></html>`;

  fs.writeFileSync(previewPath, html, 'utf8');
  console.log(`Preview saved: ${previewPath}`);
}

main().catch(err => {
  console.error(`Scheduler failed: ${err.message}`);
  process.exit(1);
});
