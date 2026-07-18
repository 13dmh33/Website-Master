'use strict';
// heat-week.js — one-off themed content drop for Techs4Tatas.
// Theme: "how hot it is across the year" — heat threaded through every slot,
// with the Friday single-image slot reserved for a 12-month heat-map backdrop.
//
// Authors the week of 2026-07-20 (week #5 plan: 2 reels + 4 posts) as a
// pipeline-valid content file, mirroring agents/generator.js assembly exactly
// (real planner plan + real link builder + real hashtag assembly) but using
// hand-authored heat copy instead of Claude/evergreen. Also writes a review
// preview that works BEFORE rendering (no skia-canvas/ffmpeg needed).
//
// Run from the miley/ dir:
//   node scripts/heat-week.js
// Then on the Mac (where native deps live), render + queue + review:
//   node agents/designer.js && FORCE_QUEUE=1 node agents/scheduler.js
//   # review output/queue/preview-2026-07-20.html, then:
//   node scripts/push-queue.js

const fs      = require('fs');
const path    = require('path');
const store   = require('../lib/store');
const planner = require('../lib/planner');
const links   = require('../lib/links');

const WEEK_OF = '2026-07-20';
const week    = store.getCurrentWeek();
const master  = store.getHashtagMaster();

// copied verbatim from agents/generator.js (buildHashtags is not exported there)
function buildHashtags(hashtagSet, isOctober, master, week) {
  if (!master) return [];
  const anchors = master.anchor_tags || [];
  let set = [...((master.sets && master.sets[hashtagSet]) || [])];
  if (set.length) {
    const shift = week % set.length;
    set = set.slice(shift).concat(set.slice(0, shift));
  }
  let tags;
  if (isOctober) {
    const add = master.october_additions || [];
    tags = [...anchors, ...set.slice(0, 6), ...add.slice(0, 3)];
  } else {
    tags = [...anchors, ...set];
  }
  return [...new Set(tags)];
}

// hand-authored heat copy, keyed by day (Riley voice; HOOK/SCENE/DONATION/CTA)
const COPY = {
  MON: {
    hook: 'Some like it hot. We live in it.',
    body: "105° in the attic and this sticker's still repping. Weatherproof, sun-proof, tradeswoman-proof.",
    donation: '30% of every profit funds breast cancer research.',
    cta: 'Tap the link in bio for the sticker 🔥',
    hashtag_set: 'product',
    suggested_visual: 'Kiss-cut sticker slapped on a sweaty stainless water bottle sitting in an attic full of pink insulation, hard light.',
    caption: [
      'Some like it hot. We live in it.',
      "105° in the attic and this sticker's still repping. Weatherproof, sun-proof, tradeswoman-proof.",
      '30% of every profit funds breast cancer research.',
      'Tap the link in bio for the sticker 🔥',
    ].join('\n\n'),
    captionVariantB: [
      'Your water bottle works as hard as you do.',
      "105° in the attic and this sticker's still repping. Weatherproof, sun-proof, tradeswoman-proof.",
      '30% of every profit funds breast cancer research.',
      'Tap the link in bio for the sticker 🔥',
    ].join('\n\n'),
    extra: [
      'Beat 1: Some like it *hot* || sticker on a sweaty water bottle, slow push in',
      'Beat 2: We *live* in it || quick cut to attic insulation work',
      'Beat 3: 105 in the *attic*, still repping || close on the sticker',
      'Beat 4: Slap it on your *bottle* || end card, logo',
    ].join('\n'),
  },

  TUE: {
    hook: "You don't have an off-season. You have a heat index.",
    body: "Boiler rooms in January, rooftops in July — you just change which sweat you're wiping. The heat doesn't break you. It proves you.",
    donation: '30% of every profit funds breast cancer research.',
    cta: 'Tag the woman who works through all of it.',
    hashtag_set: 'motivational',
    suggested_visual: 'Split-panel: same tradeswoman in a frosty January mechanical room and on a blazing July rooftop, sweat both times.',
    caption: [
      "You don't have an off-season. You have a heat index.",
      "Boiler rooms in January, rooftops in July — you just change which sweat you're wiping. The heat doesn't break you. It proves you.",
      '30% of every profit funds breast cancer research.',
      'Tag the woman who works through all of it.',
    ].join('\n\n'),
    captionVariantB: [
      'The calendar changes. The sweat never stops.',
      "Boiler rooms in January, rooftops in July — you just change which sweat you're wiping. The heat doesn't break you. It proves you.",
      '30% of every profit funds breast cancer research.',
      'Tag the woman who works through all of it.',
    ].join('\n\n'),
    extra: [
      "Slide 1: You don't have an off-season.",
      'Slide 2: January boiler rooms. July rooftops.',
      "Slide 3: You just change which sweat you're wiping.",
      "Slide 4: The heat doesn't break you. It proves you.",
      'Slide 5: 30% of every profit funds breast cancer research.',
      'Slide 6: Tag the woman who works through all of it.',
    ].join('\n'),
  },

  THU: {
    hook: "You don't melt. You forge.",
    body: "The same heat that sends everyone else to the truck for AC? That's your Tuesday. All year. Steel gets made in the fire — so do you.",
    donation: '30% of every profit funds breast cancer research.',
    cta: 'Save this for the next brutal week 🔥',
    hashtag_set: 'motivational',
    suggested_visual: 'Sun flare and heat-shimmer over a jobsite; silhouette of a tradeswoman wiping her brow, unbothered.',
    caption: [
      "You don't melt. You forge.",
      "The same heat that sends everyone else to the truck for AC? That's your Tuesday. All year. Steel gets made in the fire — so do you.",
      '30% of every profit funds breast cancer research.',
      'Save this for the next brutal week 🔥',
    ].join('\n\n'),
    captionVariantB: [
      'The heat quits before you do.',
      "The same heat that sends everyone else to the truck for AC? That's your Tuesday. All year. Steel gets made in the fire — so do you.",
      '30% of every profit funds breast cancer research.',
      'Save this for the next brutal week 🔥',
    ].join('\n\n'),
    extra: [
      "Beat 1: You don't *melt* || sun flare over a jobsite, slow push",
      'Beat 2: You *forge* || cut to sparks off a grinder',
      'Beat 3: The heat that *quits* the rest || wipe of sweat, close on eyes',
      'Beat 4: Save this for *August* || end card, logo',
    ].join('\n'),
  },

  // THE HEAT-MAP POST — Dave supplies the heat-map backdrop here
  FRI: {
    hook: 'Rate your year by how hard it tries to cook you.',
    body: "July attics. August rooftops. That one 'mild' spring week that jumps to 90 with zero warning. Every trade has a month that fights dirty.",
    donation: '30% of every profit funds breast cancer research.',
    cta: 'Drop your worst month in the comments 👇',
    hashtag_set: 'engagement',
    suggested_visual: 'DAVE SUPPLIES THIS ONE: a 12-month (Jan-Dec) calendar HEAT MAP as the background — cool blue winter months warming to deep red July/Aug. Overlay the hook in Bebas Neue, logo top-right. This is the "one image with a heat-map backdrop."',
    caption: [
      'Rate your year by how hard it tries to cook you.',
      "July attics. August rooftops. That one 'mild' spring week that jumps to 90 with zero warning. Every trade has a month that fights dirty.",
      '30% of every profit funds breast cancer research.',
      'Drop your worst month in the comments 👇',
    ].join('\n\n'),
    captionVariantB: [
      'Which month on this map tries to cook you alive?',
      "July attics. August rooftops. That one 'mild' spring week that jumps to 90 with zero warning. Every trade has a month that fights dirty.",
      '30% of every profit funds breast cancer research.',
      'Drop your worst month in the comments 👇',
    ].join('\n\n'),
    extra: '',
  },

  SAT: {
    hook: 'The sticker that survives a dashboard in July.',
    body: 'No faded corners, no peeling — it takes the heat as long as you do. Be one of the first to slap it on your rig.',
    donation: 'Buy the sticker, fund the fight — 30% goes to breast cancer research.',
    cta: 'Grab yours — link in bio.',
    hashtag_set: 'product',
    suggested_visual: 'Kiss-cut sticker on a truck dashboard in blazing sun, heat shimmer on the windshield, sticker crisp and unbothered.',
    caption: [
      'The sticker that survives a dashboard in July.',
      'No faded corners, no peeling — it takes the heat as long as you do. Be one of the first to slap it on your rig.',
      'Buy the sticker, fund the fight — 30% goes to breast cancer research.',
      'Grab yours — link in bio.',
    ].join('\n\n'),
    captionVariantB: [
      'Left it on the dash all summer. Still perfect.',
      'No faded corners, no peeling — it takes the heat as long as you do. Be one of the first to slap it on your rig.',
      'Buy the sticker, fund the fight — 30% goes to breast cancer research.',
      'Grab yours — link in bio.',
    ].join('\n\n'),
    extra: '',
  },

  SUN: {
    hook: 'Rides on your toolbox through every 100° day.',
    body: "This magnet doesn't quit when the truck bed hits oven temps — and neither does the mission behind it.",
    donation: 'Every one you buy sends 30% of profit to breast cancer research.',
    cta: 'Wear it loud, stick it proud — link in bio 🩷',
    hashtag_set: 'mission',
    suggested_visual: 'Techs4Tatas magnet on a scuffed metal toolbox in the back of a hot truck bed, late-afternoon sun.',
    caption: [
      'Rides on your toolbox through every 100° day.',
      "This magnet doesn't quit when the truck bed hits oven temps — and neither does the mission behind it.",
      'Every one you buy sends 30% of profit to breast cancer research.',
      'Wear it loud, stick it proud — link in bio 🩷',
    ].join('\n\n'),
    captionVariantB: [
      'Oven-temp truck bed. This magnet holds anyway.',
      "This magnet doesn't quit when the truck bed hits 100° — and neither does the mission behind it.",
      'Every one you buy sends 30% of profit to breast cancer research.',
      'Wear it loud, stick it proud — link in bio 🩷',
    ].join('\n\n'),
    extra: '',
  },
};

// ── assemble the content file (mirrors agents/generator.js main()) ──
function buildContent() {
  const plan  = planner.buildWeekPlan(new Date(WEEK_OF + 'T12:00:00Z'), week);
  const posts = plan.posts.map(planPost => {
    const c = COPY[planPost.day];
    if (!c) throw new Error('no copy for ' + planPost.day);
    const product = planPost.product || null;
    const tracked = links.forPost({ contentType: planPost.contentType, product, campaignMode: plan.mode });
    return {
      slot: planPost.day, day: planPost.day, time: planPost.time,
      format: planPost.format, contentType: planPost.contentType,
      paletteKey: planPost.paletteKey, reel_style: planPost.reel_style || null,
      product, isOctober: planPost.isOctober, ctaStyle: planPost.ctaStyle || '',
      tracked_link: tracked.link, utm_content: tracked.product || null,
      source: 'authored-heat', evergreenId: null,
      hook: c.hook, body: c.body, donation: c.donation, cta: c.cta,
      caption: c.caption, captionVariantB: c.captionVariantB || c.caption,
      hashtag_set: c.hashtag_set, suggested_visual: c.suggested_visual,
      extra: c.extra || '', hashtags: buildHashtags(c.hashtag_set, planPost.isOctober, master, week),
      judge: null, status: 'pending',
    };
  });
  const doc = {
    weekOf: WEEK_OF, generatedAt: new Date().toISOString(),
    campaignMode: plan.mode, week, theme: 'heat-across-the-year', posts,
  };
  const filePath = store.savePost(doc);
  return { doc, filePath };
}

// ── pre-render review preview (works without skia-canvas/ffmpeg) ──
function buildPreview(content) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const postText = p => (p.hashtags && p.hashtags.length) ? `${p.caption}\n\n${p.hashtags.join(' ')}` : p.caption;

  const cards = content.posts.map(r => {
    const isReel = r.format === 'reel';
    const isHeatMap = r.day === 'FRI';
    const label = isReel
      ? `▶ REEL · ${r.reel_style} — renders to 1080×1920 .mp4 on the Mac`
      : `▢ ${r.format} · palette: ${r.paletteKey} — renders to 1080×1080 .png on the Mac`;
    const ph = `<div class="ph ${isHeatMap ? 'heat' : ''}">${isHeatMap
      ? '🔥 HEAT-MAP IMAGE SLOT<br><span>Load your 12-month heat-map backdrop here</span>'
      : esc(label)}</div>`;
    const vis  = r.suggested_visual ? `<div class="vis">📷 ${esc(r.suggested_visual)}</div>` : '';
    const link = r.tracked_link ? `<div class="link">🔗 drives to: <a href="${esc(r.tracked_link)}" target="_blank" rel="noopener">${esc(r.tracked_link)}</a></div>` : '';
    const extra = r.extra ? `<div class="extra"><span class="lbl">${isReel ? 'reel script (on-screen || voiceover)' : 'carousel slides'}</span><pre>${esc(r.extra)}</pre></div>` : '';
    const vb = (r.captionVariantB && r.captionVariantB !== r.caption)
      ? `<details class="vb"><summary>A/B — hook variant B</summary><pre>${esc(r.captionVariantB)}</pre></details>` : '';
    return `
  <div class="post${isHeatMap ? ' spotlight' : ''}">
    <h2>${r.day} ${r.time} · ${esc(r.contentType)} <span class="fmt">${r.format}${r.reel_style ? ' · ' + r.reel_style : ''}</span>${r.product ? ` · <span class="prod">${esc(r.product)}</span>` : ''}</h2>
    ${ph}${vis}
    <pre class="cap">${esc(postText(r))}</pre>
    ${vb}${link}${extra}
  </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Techs4Tatas — HEAT week of ${content.weekOf}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#1A1A1D; color:#F7F4F0; padding:2rem; max-width:760px; margin:0 auto; }
  h1 { color:#FF2E88; margin-bottom:.2rem; } p.sub { color:#FFB3D1; margin-top:0; }
  .legend { color:#8a8a90; font-size:.82rem; background:#232327; border:1px solid #333; border-radius:10px; padding:.8rem 1rem; margin:1rem 0 2rem; line-height:1.6; }
  .post { background:#232327; border:1px solid #333; border-radius:14px; padding:1.5rem; margin-bottom:1.75rem; }
  .post.spotlight { border-color:#FF7A18; box-shadow:0 0 0 1px #FF7A18 inset; }
  .post h2 { color:#FF2E88; margin:0 0 .75rem; font-size:1rem; text-transform:uppercase; letter-spacing:.04em; }
  .fmt { color:#FFC400; font-size:.8rem; } .prod { color:#FFB3D1; font-size:.8rem; }
  .ph { background:linear-gradient(135deg,#2a2a30,#1f1f24); border:1px dashed #555; border-radius:10px; color:#9a9aa2; font-size:.8rem; text-align:center; padding:2.2rem 1rem; margin-bottom:.75rem; }
  .ph.heat { background:linear-gradient(135deg,#1e2b6b,#7a1030 55%,#c81d0f); border:1px dashed #ff9e6b; color:#fff; font-weight:700; letter-spacing:.03em; padding:3rem 1rem; }
  .ph.heat span { display:block; font-weight:400; font-size:.78rem; margin-top:.4rem; color:#ffd9c2; }
  .vis { color:#FFB3D1; font-size:.85rem; margin:.5rem 0; line-height:1.5; }
  .link { font-size:.78rem; margin:.5rem 0; color:#FFC400; word-break:break-all; } .link a { color:#FFC400; }
  pre.cap { white-space:pre-wrap; font-family:inherit; font-size:.95rem; line-height:1.6; color:#F7F4F0; background:#1A1A1D; padding:1rem; border-radius:8px; }
  .vb { margin:.5rem 0; } .vb summary { cursor:pointer; color:#FFC400; font-size:.8rem; }
  .vb pre { white-space:pre-wrap; font-family:inherit; font-size:.9rem; color:#cfcfd4; background:#1A1A1D; padding:.75rem; border-radius:8px; margin-top:.4rem; }
  .extra { margin-top:.75rem; } .extra .lbl { color:#FFC400; font-size:.72rem; text-transform:uppercase; }
  .extra pre { white-space:pre-wrap; font-family:inherit; font-size:.85rem; color:#cfcfd4; background:#1A1A1D; padding:.75rem; border-radius:8px; }
</style></head><body>
  <h1>Techs4Tatas — HEAT week 🔥</h1>
  <p class="sub">Week of ${content.weekOf} · ${content.campaignMode} mode · ${content.posts.length} posts · theme: how hot it is across the year</p>
  <div class="legend">
    <b>2 reels</b> (Mon + Thu) · <b>4 posts</b> (Tue carousel, Fri single, Sat single, Sun single).<br>
    Images/reels aren't rendered here — placeholders show what each becomes on the Mac.
    The <b style="color:#FF7A18">Friday</b> slot is the heat-map image you'll supply.<br>
    Render + queue on the Mac: <code>cd miley &amp;&amp; node agents/designer.js &amp;&amp; FORCE_QUEUE=1 node agents/scheduler.js</code>, review, then <code>node scripts/push-queue.js</code>.
  </div>
  ${cards}
</body></html>`;
  const out = path.join(store.paths.queue, `preview-${content.weekOf}.html`);
  store.ensureDir(store.paths.queue);
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

const { doc, filePath } = buildContent();
const previewPath = buildPreview(doc);
console.log(`Saved ${doc.posts.length} heat-themed posts → ${filePath}`);
console.log(`Preview → ${previewPath}`);
doc.posts.forEach(p => console.log(`  ${p.day} ${p.time} · ${p.contentType} (${p.format}${p.reel_style ? '/' + p.reel_style : ''})${p.product ? ' · ' + p.product : ''}  [${p.hashtags.length} tags]`));
