'use strict';

// planner.js — resolves the weekly posting plan for Techs4Tatas (Miley).
//
// Decides, for a given date + week counter, exactly which posts go out:
//   campaign mode (base / september / october) → which slots → for each slot a
//   { day, time, format, contentType, product, isOctober } plan object.
//
// All rotation logic lives here so researcher / generator / designer / scheduler
// agree on the same plan. Driven by templates/post-formats.json and
// templates/october-campaign.json.

const store     = require('./store');
const calendar  = require('./calendar');
const weights   = require('./product-weights');

// ── content-type → downstream mappings ─────────────────────────────────────

// reel styles the weekly rotation cycles through (overridable via
// post-formats.json `reel_styles`). card = beat-card style; kinetic_* = word-by-
// word typography (karaoke = progressive reveal, punch = one word at a time).
const REEL_STYLES = ['card', 'kinetic_karaoke', 'kinetic_punch'];

// reel CONTENT themes the rotation cycles through (overridable via
// post-formats.json `reel_content_rotation`). Separate from visual style: this
// decides what a reel is ABOUT. Product reels pull a product (photo background
// when assets/products/<key>.png exists).
const REEL_CONTENT = ['motivational', 'mission', 'product_feature_lifestyle'];

// generator-prompts FORMAT key to use when a slot doesn't pin one (October)
const DEFAULT_FORMAT = {
  trades_humor:             'single_image',
  motivational:             'reel',
  engagement:               'single_image',
  mission:                  'single_image',
  mission_recap:            'single_image',
  awareness_stat:           'single_image',
  product_feature_single:   'single_image',
  product_feature_lifestyle:'single_image',
  product_social_proof:     'single_image',
  mission_product_combo:    'single_image',
};

// content type → evergreen.json `type` for fallback selection
const EVERGREEN_TYPE = {
  trades_humor:             'trades_humor',
  motivational:             'motivational',
  engagement:               'engagement',
  mission:                  'mission',
  mission_product_combo:    'mission',
  mission_recap:            'mission',
  awareness_stat:           'mission',
  product_feature_single:   'product_feature',
  product_feature_lifestyle:'product_feature',
  product_social_proof:     'product_feature',
};

// content type → visual-config palettes_by_type key
const PALETTE_KEY = {
  trades_humor:             'trades_humor',
  motivational:             'motivational',
  engagement:               'engagement',
  mission:                  'mission',
  mission_product_combo:    'mission',
  mission_recap:            'mission',
  awareness_stat:           'awareness',
  product_feature_single:   'product_feature',
  product_feature_lifestyle:'product_feature',
  product_social_proof:     'product_feature',
};

const PRODUCT_TYPES = [
  'product_feature_single', 'product_feature_lifestyle',
  'product_social_proof', 'mission_product_combo',
];

// October weekly_rhythm `theme` → our internal contentType
const OCTOBER_THEME_TO_TYPE = {
  awareness_stat:            'awareness_stat',
  mission_donation:          'mission',
  trades_humor:              'trades_humor',
  motivational:              'motivational',
  product_spotlight:         'product_feature_single',
  product_feature_lifestyle: 'product_feature_lifestyle',
  mission_recap:             'mission_recap',
};

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// ── helpers ─────────────────────────────────────────────────────────────────

function needsProduct(contentType) { return PRODUCT_TYPES.includes(contentType); }
function evergreenTypeFor(contentType) { return EVERGREEN_TYPE[contentType] || 'mission'; }
function paletteKeyFor(contentType) { return PALETTE_KEY[contentType] || 'mission'; }

// month is 1-12
function getCampaignMode(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m === 10) return 'october';
  if (m === 9)  return 'september';
  return 'base';
}

// parse "TUE:12:00,THU:19:00,..." → { TUE: '12:00', THU: '19:00', ... }
function parseScheduleEnv(str) {
  const map = {};
  if (!str) return map;
  for (const entry of str.split(',')) {
    const i = entry.indexOf(':');
    if (i === -1) continue;
    map[entry.slice(0, i).trim().toUpperCase()] = entry.slice(i + 1).trim();
  }
  return map;
}

// map a post-formats slot.format token → generator-prompts FORMAT key
function mapSlotFormat(slotFormat, week, contentType) {
  switch (slotFormat) {
    case 'carousel':          return 'carousel';
    case 'reel_or_caption':   return week % 2 === 0 ? 'reel' : 'caption';
    case 'product_feature':   return 'single_image';
    case 'product_or_mission':return 'single_image';
    default:                  return DEFAULT_FORMAT[contentType] || 'single_image';
  }
}

// pick a contentType from a content_pool, advancing one step per use that week
function pickFromPool(poolName, pools, week, poolCounters) {
  const pool = pools[poolName];
  if (!pool || !pool.rotation || !pool.rotation.length) return 'mission';
  const idx = poolCounters[poolName] || 0;
  poolCounters[poolName] = idx + 1;
  return pool.rotation[(week + idx) % pool.rotation.length];
}

// ── main: build the week's plan ─────────────────────────────────────────────

// returns { mode, scheduleEnv, posts: [ {day, time, format, contentType, product, isOctober, paletteKey} ] }
function buildWeekPlan(date = new Date(), week = 0) {
  const mode = getCampaignMode(date);
  const formats = store.getPostFormats() || {};
  const pools   = (formats.content_pools) || {};
  const catalog = (formats.product_catalog_rotation) || [];

  // reel-style weekly rotation (#reels): every reel in a given week uses the
  // same style so the Analyst can compare engagement week-over-week. The list is
  // config-driven (post-formats.json `reel_styles`); default rotates all three.
  const styleList = (Array.isArray(formats.reel_styles) && formats.reel_styles.length)
    ? formats.reel_styles
    : REEL_STYLES;
  const weekReelStyle = styleList[((week % styleList.length) + styleList.length) % styleList.length];

  // reel content-theme rotation (motivational → mission → product → …). A reel
  // slot takes its theme from here instead of the weekday community pool, so
  // reels cycle across all three themes over successive reel weeks.
  const reelContentList = (Array.isArray(formats.reel_content_rotation) && formats.reel_content_rotation.length)
    ? formats.reel_content_rotation
    : REEL_CONTENT;
  let reelContentCounter = 0;
  const pickReelContent = () => {
    const i = week + reelContentCounter++;
    return reelContentList[((i % reelContentList.length) + reelContentList.length) % reelContentList.length];
  };

  // dynamic product-rotation weighting (#9): expands the catalog so products
  // with higher click-through appear more often; identical to plain round-robin
  // when no click data exists yet (see lib/product-weights.js).
  const weightedRotation = weights.weightedCatalog(catalog);

  let productCounter = 0;
  const nextProduct = () => {
    if (!weightedRotation.length) return null;
    const p = weightedRotation[(week + productCounter) % weightedRotation.length];
    productCounter += 1;
    return p;
  };

  const finalize = (p) => ({
    ...p,
    paletteKey: paletteKeyFor(p.contentType),
    product:    needsProduct(p.contentType) ? (p.product || nextProduct()) : null,
    reel_style: p.format === 'reel' ? weekReelStyle : null,
  });

  // ── October: daily, driven by october-campaign.json weekly_rhythm ──────────
  if (mode === 'october') {
    const oct = store.getOctoberCampaign() || {};
    const times = parseScheduleEnv(oct.daily_schedule_env);
    const rhythm = oct.weekly_rhythm || {};
    const posts = [];
    for (const day of DAY_ORDER) {
      const slot = rhythm[day];
      if (!slot) continue;
      const contentType = OCTOBER_THEME_TO_TYPE[slot.theme] || 'mission';
      posts.push(finalize({
        day,
        time:        times[day] || '12:00',
        format:      DEFAULT_FORMAT[contentType] || 'single_image',
        contentType,
        isOctober:   true,
        goal:        slot.goal || '',
        ctaStyle:    slot.cta || '',
      }));
    }
    return { mode, scheduleEnv: oct.daily_schedule_env, posts, calendarAngles: [] };
  }

  // ── base / september: slots from post-formats.json ─────────────────────────
  const base = formats.base_week || {};
  const slots = [...(base.slots || [])];
  let scheduleEnv = base.post_schedule_env;

  if (mode === 'september' && formats.september_ramp && formats.september_ramp.added_slot) {
    slots.push(formats.september_ramp.added_slot);
    scheduleEnv = formats.september_ramp.post_schedule_env || scheduleEnv;
    slots.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  }

  const poolCounters = {};
  const posts = slots.map(slot => {
    const communityType = pickFromPool(slot.content_pool, pools, week, poolCounters);
    const format = mapSlotFormat(slot.format, week, communityType);
    // reels take their theme from the reel content rotation (motivational /
    // mission / product), not the weekday community pool.
    const contentType = format === 'reel' ? pickReelContent() : communityType;
    return finalize({
      day:        slot.day,
      time:       slot.time,
      format,
      contentType,
      isOctober:  false,
      ctaStyle:   slot.cta_style || '',
    });
  });

  // ── calendar engine: date-specific observances (skipped in October — see
  // calendar.json's _purpose note; this branch never runs for mode === 'october') ──
  const calendarEntries = calendar.getActiveEntries(date);
  const override = calendarEntries.find(e => e.match_mode === 'override');
  const calendarAngles = calendarEntries
    .filter(entry => entry !== override)
    .map(entry => entry.angle);

  if (override && posts.length) {
    posts[0] = finalize({
      ...posts[0],
      contentType: override.contentType,
      format:      DEFAULT_FORMAT[override.contentType] || posts[0].format,
      calendarName:  override.name,
      calendarAngle: override.angle,
    });
  }

  return { mode, scheduleEnv, posts, calendarAngles };
}

module.exports = {
  buildWeekPlan,
  getCampaignMode,
  parseScheduleEnv,
  needsProduct,
  evergreenTypeFor,
  paletteKeyFor,
  DEFAULT_FORMAT,
  EVERGREEN_TYPE,
  PALETTE_KEY,
  PRODUCT_TYPES,
  REEL_STYLES,
  REEL_CONTENT,
};
