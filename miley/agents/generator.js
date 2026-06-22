'use strict';

// generator — content creation agent (Techs4Tatas / Miley)
// runs after researcher. Builds the week's plan (planner), then writes ONE post
// per slot using the brand brain in generator-prompts.js.
//
// For each slot:
//   1. resolve {format, contentType, product, isOctober} from the planner
//   2. build the user prompt (generator-prompts.buildUserPrompt) + SYSTEM_PROMPT
//   3. call Claude → parse JSON → passesQualityGate()
//   4. on any miss (no API key / parse fail / gate fail) → evergreen.json fallback
//   5. append hashtags from hashtag-master.json (kept OUT of the caption body)
//
// Cost control: if ANTHROPIC_API_KEY is missing OR FORCE_EVERGREEN=1, the whole
// run uses evergreen content and spends nothing. That's the safe dry-run path.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude   = require('../lib/claude');
const store    = require('../lib/store');
const glossary = require('../lib/glossary');
const planner  = require('../lib/planner');
const prompts  = require('./generator-prompts');

const USE_API = !!process.env.ANTHROPIC_API_KEY && process.env.FORCE_EVERGREEN !== '1';

// assemble the hashtag block for a post (anchors + matching set [+ October]).
// varies the set order by week so we don't post an identical block every time.
function buildHashtags(hashtagSet, isOctober, master, week) {
  if (!master) return [];
  const anchors = master.anchor_tags || [];
  let set = [...((master.sets && master.sets[hashtagSet]) || [])];

  // rotate the set by week to vary 2-3 tags per post (usage_rules.rotation)
  if (set.length) {
    const shift = week % set.length;
    set = set.slice(shift).concat(set.slice(0, shift));
  }

  let tags;
  if (isOctober) {
    const add = master.october_additions || [];
    // trim a couple weaker set tags, add 3 October tags → stays ~13-15 total
    tags = [...anchors, ...set.slice(0, 6), ...add.slice(0, 3)];
  } else {
    tags = [...anchors, ...set]; // ~11 baseline
  }
  return [...new Set(tags)]; // dedup, preserve order
}

// build the per-post brief text fed to the generator
function briefTextFor(post, brief, idx) {
  const parts = [];

  const wantsFact = post.contentType === 'awareness_stat' ||
                    post.contentType === 'mission' ||
                    post.contentType === 'mission_recap' ||
                    post.contentType === 'mission_product_combo';

  if (wantsFact && brief.facts && brief.facts.length) {
    const f = brief.facts[(brief.week + idx) % brief.facts.length];
    parts.push(`Use this VERIFIED fact — restate it in your OWN words, cite the source loosely (e.g. "per ${f.source.split('(')[0].trim()}"): "${f.claim}"`);
  }

  if (brief.seasonalAngle) parts.push(`Seasonal angle: ${brief.seasonalAngle}.`);

  if (brief.themes && brief.themes.length) {
    const t = brief.themes[(brief.week + idx) % brief.themes.length];
    parts.push(`Theme to riff on: ${t}.`);
  }

  // fresh RSS angle (live data refresh) — match the beat to the content type.
  // PARAPHRASE ONLY: never reproduce the headline; use it as a jumping-off idea.
  const live = brief.liveHeadlines || {};
  const beat = wantsFact ? (live.breast_cancer || []) : (live.women_in_trades || []);
  const pool = beat.length ? beat : (live.women_in_trades || []);
  if (pool.length) {
    const h = pool[(brief.week + idx) % pool.length];
    parts.push(`A current headline for inspiration (DO NOT quote or copy it — react to the idea in your own words): "${h}"`);
  }

  if (post.goal)    parts.push(`Goal for this post: ${post.goal}.`);
  if (post.product) parts.push(`Featured product (use its catalog key, write it naturally): ${post.product}.`);

  return parts.join('\n');
}

// normalize an evergreen.json post into our post shape
function fromEvergreen(ev) {
  return {
    source:           'evergreen',
    evergreenId:      ev.id,
    hook:             ev.hook,
    body:             ev.body,
    donation:         ev.donation || '',
    cta:              ev.cta,
    caption:          ev.caption,
    hashtag_set:      ev.hashtag_set,
    suggested_visual: ev.suggested_visual || '',
    extra:            ev.extra || '',
    product:          ev.product || null,
  };
}

// generate one post via Claude; throws on parse/gate failure so caller falls back
async function generateViaApi(planPost, brief, idx, weeklyTerms) {
  const userPrompt = prompts.buildUserPrompt({
    format:        planPost.format,
    contentType:   planPost.contentType,
    brief:         briefTextFor(planPost, brief, idx),
    glossaryTerms: weeklyTerms,
    product:       planPost.product || '',
    isOctober:     planPost.isOctober,
  });

  const maxTokens = (planPost.format === 'carousel' || planPost.format === 'reel') ? 1400 : 900;
  const raw  = await claude.call({ prompt: userPrompt, systemPrompt: prompts.SYSTEM_PROMPT, maxTokens });
  const post = claude.parseJson(raw);

  if (!prompts.passesQualityGate(post)) {
    throw new Error('quality gate failed');
  }
  return {
    source:           'claude',
    hook:             post.hook,
    body:             post.body,
    donation:         post.donation || '',
    cta:              post.cta,
    caption:          post.caption,
    hashtag_set:      post.hashtag_set,
    suggested_visual: post.suggested_visual || '',
    extra:            post.extra || '',
    product:          planPost.product || null,
  };
}

async function main() {
  const brief = store.getLatestBrief();
  if (!brief) {
    console.error('No research brief found. Run node agents/researcher.js first.');
    process.exit(1);
  }

  const master = store.getHashtagMaster();
  const week   = store.getCurrentWeek();
  const plan   = planner.buildWeekPlan(new Date(), week);

  console.log(`Generating content for week of ${brief.weekOf} — mode: ${plan.mode}, ${plan.posts.length} posts.`);
  console.log(USE_API ? 'Using Claude API for generation.' : 'No API key / FORCE_EVERGREEN — using evergreen content (zero spend).');

  const usedEvergreenIds = [];
  const posts = [];

  for (let idx = 0; idx < plan.posts.length; idx++) {
    const planPost = plan.posts[idx];
    const weeklyTerms = glossary.getWeeklyTerms(3);
    let content = null;

    if (USE_API) {
      try {
        content = await generateViaApi(planPost, brief, idx, weeklyTerms);
        console.log(`  ${planPost.day} ${planPost.contentType} (${planPost.format}) — generated via Claude.`);
      } catch (err) {
        console.warn(`  ${planPost.day} ${planPost.contentType} — Claude miss (${err.message}); using evergreen.`);
      }
    }

    if (!content) {
      const ev = store.getUnusedEvergreenByType(planner.evergreenTypeFor(planPost.contentType), usedEvergreenIds);
      if (!ev) {
        console.error(`No evergreen available for ${planPost.contentType}. Run scripts/generate-evergreen.js or check evergreen.json.`);
        process.exit(1);
      }
      usedEvergreenIds.push(ev.id);
      content = fromEvergreen(ev);
      console.log(`  ${planPost.day} ${planPost.contentType} (${planPost.format}) — evergreen ${ev.id}.`);
    }

    const hashtags = buildHashtags(content.hashtag_set, planPost.isOctober, master, week);

    posts.push({
      slot:        planPost.day,
      day:         planPost.day,
      time:        planPost.time,
      format:      planPost.format,
      contentType: planPost.contentType,
      paletteKey:  planPost.paletteKey,
      product:     content.product || planPost.product || null,
      isOctober:   planPost.isOctober,
      ctaStyle:    planPost.ctaStyle || '',
      source:      content.source,
      evergreenId: content.evergreenId || null,
      hook:             content.hook,
      body:             content.body,
      donation:         content.donation,
      cta:              content.cta,
      caption:          content.caption,
      hashtag_set:      content.hashtag_set,
      suggested_visual: content.suggested_visual,
      extra:            content.extra,
      hashtags,
      status: 'pending',
    });
  }

  if (usedEvergreenIds.length) store.markEvergreenUsed(usedEvergreenIds);

  // advance the week counter so next week's rotation moves on
  store.advanceWeek();

  const contentDoc = {
    weekOf:       brief.weekOf,
    generatedAt:  new Date().toISOString(),
    campaignMode: plan.mode,
    week,
    posts,
  };

  const filePath = store.savePost(contentDoc);
  console.log(`Content generation complete. ${posts.length} posts saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Generator failed: ${err.message}`);
  process.exit(1);
});
