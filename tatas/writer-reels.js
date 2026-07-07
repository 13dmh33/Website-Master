'use strict';

// writer-reels.js — the reels-lane writer (Phase 2).
//
// Turns 5 starter topics into Instagram Reel plans: one 30–60s spoken script
// (~90–140 words), 3 scroll-stopping hook variants, a 4–6 frame shot list
// (on-screen text per frame), and one caption with 3–5 hashtags. Appends each
// as a type:"reel", status:"pending" item to the `reels` array in
// tatas/state.json (isolated from the carousel lane).
//
// Review-first: nothing here approves or voices anything. The hook/tone gate is
// the review page + approve-reels.js.
//
// Slots: one topic per weekday next week (label only — reels don't auto-post,
// so there's no scheduledFor). Idempotent: if reels for the target week already
// exist, the run is a no-op.
//
// usage:
//   node writer-reels.js                    # Claude if ANTHROPIC_API_KEY set, else fallback
//   node writer-reels.js --fallback         # force built-in fallback reels (zero spend)
//   node writer-reels.js --dry-run          # print, don't write state
//   node writer-reels.js --week 2026-07-13  # explicit week (Monday date)

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const reelsState = require('./lib/reels-state');

const DRY_RUN        = process.argv.includes('--dry-run');
const FORCE_FALLBACK = process.argv.includes('--fallback');
const MODEL          = process.env.TATAS_MODEL || 'claude-opus-4-8';
const HANDLE         = process.env.TATAS_IG_HANDLE || '@tech4tatas';

// ── Phase 2 starter topics (reel-style angles) ──────────────────────────────
const TOPICS = [
  { key: 'mammogram-age-explained', title: 'When mammograms should actually start (the age question)' },
  { key: 'self-check-in-60-seconds', title: 'The monthly self-check, in 60 seconds' },
  { key: 'dense-breast-tissue', title: 'Dense breast tissue: what it means for your screening' },
  { key: 'benign-vs-worth-a-call', title: 'Most lumps are benign — here is what is still worth a call' },
  { key: 'what-to-say-when-someone-tells-you', title: 'What to say when someone tells you they were diagnosed' },
];

const SLOT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// ── Sensitivity rules — SAME as Phase 1 (carousel) writer ───────────────────
const SYSTEM_PROMPT = `You write educational Instagram Reels scripts about breast cancer awareness for the brand Tech 4 Tatas (${HANDLE}). The script is spoken aloud as a voiceover.

Non-negotiable content rules:
- Respectful and non-alarmist. Education tone, not clinical. Warm, clear, plain spoken language.
- Medically accurate. If you are not certain a claim is accurate, leave it out.
- No fear-mongering: never use scare statistics, worst-case framing, or urgency pressure.
- No diagnostic claims: never tell viewers they do or don't have a condition, and never imply self-checks can diagnose anything.
- Attribute every statistic to a source type, e.g. "per the American Cancer Society", "per the W.H.O." (spell out abbreviations for the voiceover). No unattributed numbers.
- Always encourage professional screening and talking to a doctor — this content supplements medical care, never replaces it.
- Inclusive: breast cancer affects people of all genders; avoid language that excludes.
- No graphic imagery or descriptions.

Output format — respond with ONLY a JSON object, no markdown fences:
{
  "script": "the spoken voiceover, 90 to 140 words, 30-60 seconds read aloud. Natural spoken sentences (this is read, not shown). Open strong, close by pointing to a doctor/professional screening.",
  "hooks": ["exactly 3 scroll-stopping opening-line hook variants, each <= 90 characters, spoken/on-screen style, none fear-based"],
  "shotList": ["4 to 6 frames. Each is the ON-SCREEN TEXT for that frame (short, <= 60 chars) — not camera directions."],
  "caption": "2-4 short sentences for the post caption, same tone, ending with a gentle CTA to save/share and talk to a doctor. No hashtags in the body.",
  "hashtags": ["3 to 5 hashtags, lowercase, no spaces, mixing broad awareness tags and niche ones"]
}`;

// ── Built-in fallback reels (zero-API dry-runs; medically conservative) ─────
const FALLBACK = {
  'mammogram-age-explained': {
    script: "Quick one that trips a lot of people up: when should mammograms actually start? For years the number everyone remembered was fifty. But recent guidance from the U.S. Preventive Services Task Force now recommends many people begin at forty. And if you have a family history or dense breast tissue, your doctor might suggest starting even earlier, or adding other imaging. The real takeaway isn't a magic number — it's that the right schedule is personal. So do one thing this week: ask your doctor what screening plan fits your specific risk. Five minutes now, real peace of mind later.",
    hooks: [
      'The mammogram age everyone remembers is out of date.',
      'Wait — mammograms might start earlier than you think.',
      'Fifty? Forty? Here\'s what the guidance actually says now.',
    ],
    shotList: [
      'When should mammograms start?',
      'Old answer everyone remembers: 50',
      'Updated guidance: many start at 40 (per USPSTF)',
      'Family history or dense tissue? Maybe earlier',
      'The right schedule is personal',
      'Ask your doctor what fits your risk',
    ],
    caption: 'The recommended starting age for mammograms moved to 40 for many people (per the U.S. Preventive Services Task Force) — but the right plan depends on your personal risk. Save this and bring the question to your next appointment.',
    hashtags: ['#breastcancerawareness', '#mammogram', '#earlydetection', '#womenshealth'],
  },
  'self-check-in-60-seconds': {
    script: "Here's your monthly self-check in about a minute. First, look: in the mirror, arms down, then raised — you're just noticing any change in shape, skin, or the way things sit. Next, feel while standing: flat fingers, small circles, cover the whole area including up into the armpit. Then feel lying down, same pattern. That's it. The goal isn't to diagnose anything — it's simply to learn what normal feels like for you, so you'd notice if something changed. And if you ever do notice a change, that's not a verdict — it's just a good reason to call your doctor. Same time each month, and you're set.",
    hooks: [
      'Your whole monthly self-check, in about 60 seconds.',
      'Nobody taught us how to actually do this. Let\'s fix that.',
      'Three steps, one minute, once a month.',
    ],
    shotList: [
      'The 60-second monthly self-check',
      'LOOK: mirror, arms down then up',
      'FEEL standing: flat fingers, small circles',
      'FEEL lying down: same pattern',
      'Goal: know YOUR normal (not to diagnose)',
      'Notice a change? Call your doctor',
    ],
    caption: 'A monthly self-check takes about a minute, and it is not a diagnostic tool — it just helps you learn what normal feels like for you, so changes get in front of a doctor early. Save this as your monthly reminder.',
    hashtags: ['#selfcheck', '#breasthealth', '#knowyournormal', '#breastcancerawareness'],
  },
  'dense-breast-tissue': {
    script: "If a mammogram report ever said you have dense breast tissue, here's what that actually means — no alarm needed. Dense tissue is common and totally normal; it simply means you have more glandular and fibrous tissue relative to fat. Two things worth knowing: dense tissue can make mammograms a little harder to read, and it's considered one factor in overall risk. That's not a reason to worry — it's a reason to have an informed conversation. Ask your doctor whether your density means you'd benefit from additional screening, like an ultrasound or M.R.I. Knowing your density just helps you and your doctor screen a little smarter.",
    hooks: [
      '"Dense breast tissue" on your report? Here\'s what it means.',
      'This one line on your mammogram is worth understanding.',
      'Dense tissue isn\'t a diagnosis — it\'s a conversation.',
    ],
    shotList: [
      '"Dense breast tissue" — what it means',
      'It\'s common and normal',
      'More glandular/fibrous tissue vs fat',
      'Can make mammograms harder to read',
      'One factor in overall risk',
      'Ask your doctor about extra screening',
    ],
    caption: 'Dense breast tissue is common and normal — but it can make mammograms harder to read and is one factor in risk. If your report mentions it, ask your doctor whether additional screening makes sense for you. Knowledge, not worry.',
    hashtags: ['#densebreasts', '#breasthealth', '#screening', '#breastcancerawareness'],
  },
  'benign-vs-worth-a-call': {
    script: "Let's take some fear out of the word lump. Here's the reassuring part first: most breast lumps are not cancer. Cysts, fibroadenomas, and normal hormonal changes are all common, and many lumps come and go with your cycle. So finding something is not a verdict. That said, a few things are worth a call to your doctor — not to panic, just to check: a new lump that sticks around, skin dimpling, nipple changes, or unusual discharge. You don't have to know what it is; that's the doctor's job. Your job is simply to notice a change and make the appointment. Early conversations are always the win.",
    hooks: [
      'Most lumps aren\'t cancer. Here\'s what\'s still worth a call.',
      'Found something? Take a breath — then read this.',
      'A lump is information, not a verdict.',
    ],
    shotList: [
      'Most breast lumps are NOT cancer',
      'Cysts & benign changes are common',
      'Still worth a call: a lump that stays',
      'Also: skin dimpling, nipple changes',
      'You don\'t have to know what it is',
      'Notice a change → make the appointment',
    ],
    caption: 'Most lumps turn out to be benign — but a new lump that sticks around, skin dimpling, or nipple changes are worth a professional look. This is education, not diagnosis: notice a change, and let your doctor take it from there.',
    hashtags: ['#breasthealth', '#earlydetection', '#breastcancerawareness', '#healtheducation'],
  },
  'what-to-say-when-someone-tells-you': {
    script: "Someone you love says the words: I was just diagnosed. And your mind goes blank. Here's the good news — you don't need the perfect thing to say. Skip \"let me know if you need anything,\" because they rarely will. Offer something specific instead: \"I'm dropping off dinner Tuesday,\" or \"I'll drive you to that appointment.\" Then mostly, just listen — you don't have to fix it. And keep showing up after the first week, because treatment is a marathon, not a moment. Leave the medical questions to their care team; your job is presence. That's it. Being there, consistently, is the whole thing.",
    hooks: [
      '"I was just diagnosed." Here\'s what to actually say.',
      'When someone tells you, most of us freeze. Try this.',
      'You don\'t need perfect words. You need this.',
    ],
    shotList: [
      'When someone says "I was diagnosed"',
      'Skip "let me know if you need anything"',
      'Offer something specific instead',
      '"I\'m bringing dinner Tuesday"',
      'Listen more than you advise',
      'Keep showing up after week one',
    ],
    caption: 'When someone is diagnosed, presence beats perfect words. Offer something specific, listen without fixing, and keep showing up after the first wave of support fades. Share this with someone who needs it today.',
    hashtags: ['#breastcancersupport', '#caregiver', '#breastcancerawareness', '#community'],
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function nextMonday() {
  const now = new Date();
  const daysToNextMonday = ((1 - now.getUTCDay() + 7) % 7) || 7;
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + daysToNextMonday);
  return d.toISOString().split('T')[0];
}

function wordCount(s) { return (s || '').trim().split(/\s+/).filter(Boolean).length; }

function validate(reel, topic) {
  const errs = [];
  const wc = wordCount(reel.script);
  if (typeof reel.script !== 'string' || wc < 70 || wc > 170) errs.push(`script must be ~90-140 words, got ${wc}`);
  if (!Array.isArray(reel.hooks) || reel.hooks.length !== 3) errs.push(`hooks must be exactly 3, got ${reel.hooks?.length}`);
  if ((reel.hooks || []).some(h => typeof h !== 'string' || !h.trim() || h.length > 110)) errs.push('each hook must be a non-empty string <= 110 chars');
  if (!Array.isArray(reel.shotList) || reel.shotList.length < 4 || reel.shotList.length > 6) errs.push(`shotList must be 4-6 frames, got ${reel.shotList?.length}`);
  if (typeof reel.caption !== 'string' || reel.caption.length < 40) errs.push('caption too short');
  if (!Array.isArray(reel.hashtags) || reel.hashtags.length < 3 || reel.hashtags.length > 5) errs.push(`hashtags must be 3-5, got ${reel.hashtags?.length}`);
  if (errs.length) throw new Error(`Topic "${topic.key}" failed validation: ${errs.join('; ')}`);
}

async function generateWithClaude(topic) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Write the Reel for this topic: "${topic.title}". Respond with only the JSON object.`,
    }],
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON object in model response for "${topic.key}"`);
  return JSON.parse(jsonMatch[0]);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const weekOf  = argValue('--week') || nextMonday();
  const current = reelsState.load();

  if (current.reels.some(r => r.weekOf === weekOf)) {
    console.log(`Reels for week ${weekOf} already exist in state.json — nothing to do.`);
    return;
  }

  const useClaude = !FORCE_FALLBACK && !!process.env.ANTHROPIC_API_KEY;
  console.log(`Reels writer: week of ${weekOf} · ${TOPICS.length} topics · source: ${useClaude ? `Claude (${MODEL})` : 'built-in fallback'}${DRY_RUN ? ' · DRY RUN' : ''}`);

  const reels = [];
  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    let content, source = 'fallback';

    if (useClaude) {
      try {
        content = await generateWithClaude(topic);
        validate(content, topic);
        source = 'claude';
      } catch (err) {
        console.warn(`  ⚠ ${topic.key}: Claude generation failed (${err.message}) — using fallback.`);
        content = FALLBACK[topic.key];
      }
    } else {
      content = FALLBACK[topic.key];
    }
    validate(content, topic);

    reels.push({
      id:        `${weekOf}-${SLOT_DAYS[i]}-${topic.key}`,
      type:      'reel',
      weekOf,
      slot:      SLOT_DAYS[i],
      topic:     topic.title,
      topicKey:  topic.key,
      script:    content.script,
      hooks:     content.hooks,
      chosenHook: null,
      shotList:  content.shotList,
      caption:   content.caption,
      hashtags:  content.hashtags,
      source,
      status:    'pending',
      createdAt: new Date().toISOString(),
    });
    console.log(`  ✓ ${SLOT_DAYS[i]} · ${topic.key} · ${wordCount(content.script)}w script, 3 hooks, ${content.shotList.length} frames (${source})`);
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(reels, null, 2));
    console.log('Dry run — state.json untouched.');
    return;
  }

  reelsState.addReels(reels);
  console.log(`Done — ${reels.length} pending reels written to tatas/state.json (reels[]). Next: node scripts/publish-reels-review.js`);
}

main().catch(err => {
  console.error(`writer-reels failed: ${err.message}`);
  process.exit(1);
});
