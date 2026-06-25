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
const calendar = require('../lib/calendar');
const links    = require('../lib/links');
const prompts  = require('./generator-prompts');

const USE_API = !!process.env.ANTHROPIC_API_KEY && process.env.FORCE_EVERGREEN !== '1';

// generate-then-judge (#1): how many variants to request per slot in one call,
// and whether to run the judge pass at all. Cost control — set VARIANT_COUNT=1
// to fall back to the old single-shot behavior (one Claude call, no judge).
const VARIANT_COUNT = Math.max(1, parseInt(process.env.VARIANT_COUNT || '3', 10));

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

  // calendar.json overrides this specific slot — takes priority as the post's angle
  if (post.calendarAngle) parts.push(`Today's observance (${post.calendarName}): ${post.calendarAngle}`);

  // calendar.json supplements (no slot override) — extra context, not the headline angle
  if (brief.calendarAngles && brief.calendarAngles.length) {
    const c = brief.calendarAngles[(brief.week + idx) % brief.calendarAngles.length];
    parts.push(`Also relevant this week: ${c}`);
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
    captionVariantB:  ev.caption, // no real A/B for evergreen — same text both ways
    hashtag_set:      ev.hashtag_set,
    suggested_visual: ev.suggested_visual || '',
    extra:            ev.extra || '',
    product:          ev.product || null,
  };
}

// past top performers of the same content type, as few-shot examples (#2).
// top-performers.json is keyed by the same broad bucket analyst.js's guessNiche
// uses (trades_humor | motivational | engagement | mission | product_feature),
// so narrow content types collapse onto evergreenTypeFor's bucket to match.
function topPerformersFor(contentType) {
  const bucket = planner.evergreenTypeFor(contentType);
  const data = store.getTopPerformers();
  const list = (data.byType && data.byType[bucket]) || [];
  return list.slice(0, 3);
}

// shape a raw variant object (one element of the N-variant array) into our post shape
function shapeVariant(post, planPost) {
  return {
    source:           'claude',
    hook:             post.hook,
    body:             post.body,
    donation:         post.donation || '',
    cta:              post.cta,
    caption:          post.caption,
    captionVariantB:  post.captionVariantB || post.caption, // fall back to A if Claude omitted it
    hashtag_set:      post.hashtag_set,
    suggested_visual: post.suggested_visual || '',
    extra:            post.extra || '',
    product:          planPost.product || null,
  };
}

// ask the judge to score compliant variants and pick the best one (#1).
// Only ever sees variants that already passed passesQualityGate — judge can
// break ties among compliant posts, never override brand-safety rules.
async function judgeVariants(variants) {
  const judgePrompt = prompts.buildJudgePrompt(variants);
  const raw = await claude.call({ prompt: judgePrompt, systemPrompt: prompts.JUDGE_SYSTEM_PROMPT, maxTokens: 600 });
  const result = claude.parseJson(raw);
  const winnerIndex = (result && Number.isInteger(result.winnerIndex)) ? result.winnerIndex : 0;
  const scoreEntry = (result.scores || []).find(s => s.index === winnerIndex);
  return {
    winnerIndex: variants[winnerIndex] ? winnerIndex : 0,
    judge: {
      scores:     result.scores || [],
      winnerScore: scoreEntry ? scoreEntry.score : null,
      reasoning:   scoreEntry ? scoreEntry.reasoning : null,
    },
  };
}

// generate one post via Claude: request N variants in one call, pre-filter with the
// hard quality gate, judge the survivors to pick the best (generate-then-judge, #1).
// Throws if zero variants pass the gate, so the caller falls back to evergreen.
async function generateViaApi(planPost, brief, idx, weeklyTerms) {
  const userPrompt = prompts.buildUserPrompt({
    format:        planPost.format,
    contentType:   planPost.contentType,
    brief:         briefTextFor(planPost, brief, idx),
    glossaryTerms: weeklyTerms,
    product:       planPost.product || '',
    isOctober:     planPost.isOctober,
    variantCount:  VARIANT_COUNT,
    topPerformers: topPerformersFor(planPost.contentType),
  });

  const maxTokens = ((planPost.format === 'carousel' || planPost.format === 'reel') ? 1400 : 900) * VARIANT_COUNT;
  const raw = await claude.call({ prompt: userPrompt, systemPrompt: prompts.SYSTEM_PROMPT, maxTokens });
  const parsed = claude.parseJson(raw);
  const rawVariants = Array.isArray(parsed) ? parsed : [parsed];

  const compliant = rawVariants.filter(v => prompts.passesQualityGate(v));
  if (!compliant.length) throw new Error('quality gate failed for all variants');

  if (compliant.length === 1) {
    return shapeVariant(compliant[0], planPost);
  }

  try {
    const { winnerIndex, judge } = await judgeVariants(compliant);
    const shaped = shapeVariant(compliant[winnerIndex], planPost);
    shaped.judge = { ...judge, variantsConsidered: compliant.length };
    return shaped;
  } catch (err) {
    console.warn(`  judge call failed (${err.message}) — using the first compliant variant.`);
    return shapeVariant(compliant[0], planPost);
  }
}

async function main() {
  const brief = store.getLatestBrief();
  if (!brief) {
    console.error('No research brief found. Run node agents/researcher.js first.');
    process.exit(1);
  }

  const master = store.getHashtagMaster();
  const week   = store.getCurrentWeek();
  // plan against the week these posts will actually go out in (next week,
  // per the Thu-generate-for-following-week design), not the current week —
  // otherwise calendar/holiday overrides and campaign mode (month) check
  // against the wrong week.
  const plan   = planner.buildWeekPlan(calendar.nextWeekDate(), week);

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

    const product = content.product || planPost.product || null;
    const tracked = links.forPost({ contentType: planPost.contentType, product, campaignMode: plan.mode });

    posts.push({
      slot:        planPost.day,
      day:         planPost.day,
      time:        planPost.time,
      format:      planPost.format,
      contentType: planPost.contentType,
      paletteKey:  planPost.paletteKey,
      product,
      isOctober:   planPost.isOctober,
      ctaStyle:    planPost.ctaStyle || '',
      tracked_link: tracked.link,        // UTM-tagged bio link this post drives to (null for comment/tag posts)
      utm_content:  tracked.product || null,
      source:      content.source,
      evergreenId: content.evergreenId || null,
      hook:             content.hook,
      body:             content.body,
      donation:         content.donation,
      cta:              content.cta,
      caption:          content.caption,
      captionVariantB:  content.captionVariantB || content.caption,
      hashtag_set:      content.hashtag_set,
      suggested_visual: content.suggested_visual,
      extra:            content.extra,
      hashtags,
      judge: content.judge || null, // generate-then-judge scoring (#1), null for evergreen/single-variant posts
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
