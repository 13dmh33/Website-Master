'use strict';

// writer.js — the one genuinely new module in the tatas lane.
//
// Turns 5 starter topics into 4–8 slide educational carousels (one line of
// on-card text per slide + caption + 3–5 hashtags) via the Anthropic API,
// and appends them to tatas/state.json as 'pending'. Review-first: nothing
// here posts anything — approve-week.js is the gate.
//
// Slots: MON–FRI 12:00 MT next week (one topic per weekday). Idempotent:
// if posts for the target week already exist, the run is a no-op.
//
// usage:
//   node writer.js                    # Claude if ANTHROPIC_API_KEY set, else fallback
//   node writer.js --fallback         # force built-in fallback carousels (zero spend)
//   node writer.js --dry-run          # print, don't write state
//   node writer.js --week 2026-07-13  # explicit week (Monday date)

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const state = require('./lib/state');

const DRY_RUN        = process.argv.includes('--dry-run');
const FORCE_FALLBACK = process.argv.includes('--fallback');
const FORCE          = process.argv.includes('--force'); // regenerate a week even if it exists
// Haiku is plenty for this structured fill-in-the-JSON task and ~5x cheaper than
// Opus; override with TATAS_MODEL if you ever want a heavier model.
const MODEL          = process.env.TATAS_MODEL || 'claude-haiku-4-5';
const HANDLE         = process.env.TATAS_IG_HANDLE || '@tech4tatas';

// Hardcoded medical guidance below (fallback carousels) — RE-VERIFY BY 2026-12-31.
// Screening-age guidance and stats drift; re-check against ACS / USPSTF yearly.
const MEDICAL_REVIEW_BY = '2026-12-31';

// ── Phase 1 starter topics — one per weekday slot ───────────────────────────
const TOPICS = [
  { key: 'myth-mammogram-age',  title: 'Myth vs fact: what age should mammograms start?' },
  { key: 'self-check-3-steps',  title: 'The 3-step monthly self-check (know your normal)' },
  { key: 'what-a-lump-feels-like', title: 'What a lump actually feels like — and what else to watch for' },
  { key: 'risk-factors-you-can-act-on', title: 'Risk factors you can act on vs the ones you cannot' },
  { key: 'supporting-someone-diagnosed', title: 'How to actually support someone just diagnosed' },
];

const SLOT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const SLOT_TIME = '12:00'; // MT

// ── Sensitivity rules — enforced in the system prompt, verbatim per spec ────
const SYSTEM_PROMPT = `You write educational Instagram carousel content about breast cancer awareness for the brand Tech 4 Tatas (${HANDLE}).

Non-negotiable content rules:
- Respectful and non-alarmist. Education tone, not clinical. Warm, clear, plain language.
- Medically accurate. If you are not certain a claim is accurate, leave it out.
- No fear-mongering: never use scare statistics, worst-case framing, or urgency pressure.
- No diagnostic claims: never tell readers they do or don't have a condition, and never imply self-checks can diagnose anything.
- Attribute every statistic to a source type, e.g. "per ACS", "per WHO", "per USPSTF". No unattributed numbers.
- Always encourage professional screening and talking to a doctor — this content supplements medical care, never replaces it.
- Inclusive: breast cancer affects people of all genders; avoid language that excludes.
- No graphic imagery or descriptions.

Output format — respond with ONLY a JSON object, no markdown fences:
{
  "slides": ["one line of on-card text per slide, 4 to 8 slides, each <= 110 characters. Slide 1 is the hook/title. The last slide must point to professional screening or a doctor conversation."],
  "caption": "2-4 short sentences expanding the topic in the same tone, ending with a gentle CTA to save/share and talk to a doctor. No hashtags in the body.",
  "hashtags": ["3 to 5 hashtags, lowercase, no spaces, mixing broad awareness tags and niche ones"]
}`;

// ── Built-in fallback carousels (zero-API dry-runs; medically conservative) ─
const FALLBACK = {
  'myth-mammogram-age': {
    slides: [
      'MYTH vs FACT: when should mammograms start?',
      'Myth: "Only worry about mammograms at 50."',
      'Fact: current guidance recommends starting at 40 for many people (per USPSTF).',
      'Family history or dense breast tissue? Your doctor may suggest a different plan.',
      'The right schedule is personal — ask your doctor what fits YOUR risk.',
    ],
    caption: 'Mammogram timing changed — recent guidance moved the recommended starting age to 40 for many people (per USPSTF). The right schedule depends on your personal risk, so the best move is a 5-minute conversation with your doctor. Save this for your next appointment.',
    hashtags: ['#breastcancerawareness', '#mammogram', '#earlydetection', '#womenshealth'],
  },
  'self-check-3-steps': {
    slides: [
      'The 3-step monthly self-check',
      'Step 1: LOOK — in a mirror, arms down then raised. Notice any changes in shape or skin.',
      'Step 2: FEEL standing — flat fingers, small circles, cover the whole chest and underarm.',
      'Step 3: FEEL lying down — same pattern, once a month, same time each cycle.',
      'Self-checks are about knowing YOUR normal — they never replace professional screening.',
      'Notice a change? Not a diagnosis — just a reason to call your doctor.',
    ],
    caption: 'A monthly self-check takes five minutes, and the goal is simple: learn what normal feels like for you, so you notice when something changes. It is not a diagnostic tool and never replaces professional screening — it is the habit that gets changes in front of a doctor early. Save this as your monthly reminder.',
    hashtags: ['#selfcheck', '#breasthealth', '#knowyournormal', '#breastcancerawareness'],
  },
  'what-a-lump-feels-like': {
    slides: [
      'What does a lump actually feel like?',
      'Often: a firm knot, like a frozen pea — but lumps vary a lot from person to person.',
      'Many lumps are NOT cancer — cysts and benign changes are common.',
      'Also worth mentioning to a doctor: skin dimpling, nipple changes, unusual discharge.',
      'A change is information, not a verdict. Only a professional can tell you what it is.',
      'Found something new? Book the appointment. Early conversations matter.',
    ],
    caption: 'Most of us have never been told what to actually feel for. Lumps vary — and many turn out to be benign — but any new change is worth a professional look. This is education, not diagnosis: if something feels different, the next step is always your doctor, not a search bar.',
    hashtags: ['#breasthealth', '#earlydetection', '#breastcancerawareness', '#healtheducation'],
  },
  'risk-factors-you-can-act-on': {
    slides: [
      'Breast cancer risk: what you can act on vs what you cannot',
      'Cannot change: age, family history, genetics. Knowing them helps you screen smarter.',
      'Can act on: regular activity, limiting alcohol, keeping up with screening (per ACS).',
      'Higher fixed risk = a reason for an earlier screening conversation, not for fear.',
      'Talk to your doctor about your personal risk — that is the real action item.',
    ],
    caption: 'Risk is not destiny — it is a screening plan. Some factors are fixed, and knowing them means you and your doctor can screen smarter and earlier. Others, like activity and alcohol, are in your hands (per ACS). Either way, the most useful step is the same: a personal risk conversation with your doctor.',
    hashtags: ['#breastcancerawareness', '#prevention', '#womenshealth', '#knowyourrisk'],
  },
  'supporting-someone-diagnosed': {
    slides: [
      'Someone you love was just diagnosed. Now what?',
      'Skip "let me know if you need anything" — offer something specific instead.',
      '"I\'m bringing dinner Tuesday" beats a hundred vague offers.',
      'Listen more than you advise. You do not need the perfect words.',
      'Keep showing up after week one — treatment is a marathon, not a moment.',
      'Their medical questions belong with their care team; your job is presence.',
    ],
    caption: 'When someone is diagnosed, most of us freeze — we want to help and have no script. The good news: presence beats perfection. Offer something specific, listen without fixing, and keep showing up long after the first wave of support fades. Share this with someone who needs it today.',
    hashtags: ['#breastcancersupport', '#caregiver', '#breastcancerawareness', '#community'],
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// next week's Monday (UTC date string YYYY-MM-DD)
function nextMonday() {
  const now = new Date();
  const daysToNextMonday = ((1 - now.getUTCDay() + 7) % 7) || 7;
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + daysToNextMonday);
  return d.toISOString().split('T')[0];
}

// weekOf Monday + day offset at SLOT_TIME MT(-6) → ISO UTC (same fixed-offset
// convention Miley's scheduler uses)
function scheduledFor(weekOf, dayIdx) {
  const [h, m] = SLOT_TIME.split(':').map(Number);
  const d = new Date(`${weekOf}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dayIdx);
  d.setUTCHours(h + 6, m, 0, 0);
  return d.toISOString();
}

function validate(post, topic) {
  const errs = [];
  if (!Array.isArray(post.slides) || post.slides.length < 4 || post.slides.length > 8) {
    errs.push(`slides must be 4-8, got ${post.slides?.length}`);
  }
  if ((post.slides || []).some(s => typeof s !== 'string' || !s.trim() || s.length > 140)) {
    errs.push('every slide must be a non-empty string <= 140 chars');
  }
  if (typeof post.caption !== 'string' || post.caption.length < 40) errs.push('caption too short');
  if (!Array.isArray(post.hashtags) || post.hashtags.length < 3 || post.hashtags.length > 5) {
    errs.push(`hashtags must be 3-5, got ${post.hashtags?.length}`);
  }
  if (errs.length) throw new Error(`Topic "${topic.key}" failed validation: ${errs.join('; ')}`);
}

async function generateWithClaude(topic) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Write the carousel for this topic: "${topic.title}". Respond with only the JSON object.`,
    }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON object in model response for "${topic.key}"`);
  return JSON.parse(jsonMatch[0]);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const weekOf = argValue('--week') || nextMonday();
  const current = state.load();

  if (!FORCE && current.posts.some(p => p.weekOf === weekOf)) {
    console.log(`Posts for week ${weekOf} already exist in state.json — nothing to do. (Use --force to regenerate.)`);
    return;
  }
  if (FORCE) {
    // drop existing posts for this week so we regenerate cleanly
    current.posts = current.posts.filter(p => p.weekOf !== weekOf);
    state.save(current);
    console.log(`--force: cleared existing posts for week ${weekOf}.`);
  }

  const useClaude = !FORCE_FALLBACK && !!process.env.ANTHROPIC_API_KEY;
  console.log(`Writer: week of ${weekOf} · ${TOPICS.length} topics · source: ${useClaude ? `Claude (${MODEL})` : 'built-in fallback'}${DRY_RUN ? ' · DRY RUN' : ''}`);

  const posts = [];
  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    let content;
    let source = 'fallback';

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

    const post = {
      id:           `${weekOf}-${SLOT_DAYS[i]}-${topic.key}`,
      weekOf,
      slot:         SLOT_DAYS[i],
      time:         SLOT_TIME,
      scheduledFor: scheduledFor(weekOf, i),
      topic:        topic.title,
      topicKey:     topic.key,
      format:       'carousel',
      slides:       content.slides,
      caption:      content.caption,
      hashtags:     content.hashtags,
      postText:     `${content.caption}\n\n${content.hashtags.join(' ')}`,
      source,
      status:       'pending',
      createdAt:    new Date().toISOString(),
    };
    posts.push(post);
    console.log(`  ✓ ${post.slot} ${SLOT_TIME}MT · ${topic.key} · ${post.slides.length} slides (${source})`);
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(posts, null, 2));
    console.log('Dry run — state.json untouched.');
    return;
  }

  state.addPosts(posts);
  console.log(`Done — ${posts.length} pending posts written to tatas/state.json. Next: node designer.js`);
}

main().catch(err => {
  console.error(`writer failed: ${err.message}`);
  process.exit(1);
});
