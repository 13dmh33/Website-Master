'use strict';

// writer-reels.js — the reels-lane writer (Phase 2, realness pass).
//
// Produces Reel plans built to feel like a real creator made them, NOT a
// gradient text-card slideshow:
//   - script: spoken for the EAR (contractions, direct address, punctuation
//     pacing), 30–60s / ~90–140 words
//   - hooks: 3 scroll-stopping opening lines
//   - beats: 5–7 { broll, caption } pairs — `broll` is a real-footage search
//     phrase (Pexels/Pixabay), `caption` is SHORT on-screen text meant to be
//     shown as native word-by-word captions over that footage
//   - caption + 3–5 hashtags
//
// Topics are DISTINCT from the carousel lane (no cannibalization). Reels live
// in the isolated reels[] array; nothing here approves or voices anything.
//
// usage:
//   node writer-reels.js                    # Claude if ANTHROPIC_API_KEY set, else fallback
//   node writer-reels.js --fallback         # force built-in fallback reels (zero spend)
//   node writer-reels.js --force            # regenerate the week even if it exists
//   node writer-reels.js --dry-run
//   node writer-reels.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const reelsState = require('./lib/reels-state');

const DRY_RUN        = process.argv.includes('--dry-run');
const FORCE_FALLBACK = process.argv.includes('--fallback');
const FORCE          = process.argv.includes('--force');
// Haiku is ideal for this structured task and ~5x cheaper than Opus.
const MODEL          = process.env.TATAS_MODEL || 'claude-haiku-4-5';
const HANDLE         = process.env.TATAS_IG_HANDLE || '@tech4tatas';

// Hardcoded medical guidance below — RE-VERIFY BY 2026-12-31 against ACS/USPSTF.
const MEDICAL_REVIEW_BY = '2026-12-31';

// ── Reel topics — DISTINCT from the carousel lane's five ────────────────────
const TOPICS = [
  { key: 'mammogram-myths',        title: 'Deodorant, underwire, and other things that do NOT cause breast cancer' },
  { key: 'first-mammogram',        title: 'What your first mammogram is actually like (it is quick)' },
  { key: 'beyond-the-lump',        title: 'Changes to notice that aren\'t a lump' },
  { key: 'questions-for-doctor',   title: '3 questions to ask your doctor about your own risk' },
  { key: 'men-get-it-too',         title: 'Yes, men get breast cancer too' },
];

const SLOT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// ── Sensitivity rules (same as carousel) + spoken-cadence direction ─────────
const SYSTEM_PROMPT = `You write short-form Instagram Reels for the brand Tech 4 Tatas (${HANDLE}). The script is spoken aloud as a voiceover by one real-sounding person, over real b-roll footage with native captions.

NON-NEGOTIABLE content rules:
- Respectful and non-alarmist. Education tone, not clinical. Warm, plain, human.
- Medically accurate. If you are not certain a claim is accurate, leave it out.
- No fear-mongering: no scare statistics, worst-case framing, or urgency pressure.
- No diagnostic claims: never tell viewers they do or don't have a condition, and never imply self-checks diagnose anything.
- Attribute every statistic to a source type, spelled out for the voice, e.g. "the American Cancer Society", "the World Health Organization". No unattributed numbers.
- Always encourage professional screening and talking to a doctor — supplements medical care, never replaces it.
- Inclusive: breast cancer affects people of all genders.
- No graphic imagery or descriptions.

WRITE THE SCRIPT FOR THE EAR, not the page — this is the difference between feeling real and feeling like AI:
- Use contractions and everyday words. Short sentences. One idea at a time.
- Open mid-thought like a real person: "Okay, real talk —", "So nobody tells you this, but", "Quick one —".
- Talk directly to one viewer ("you"), ask a rhetorical question, let it breathe.
- Use punctuation for pacing: em dashes and ellipses read as natural pauses in the voiceover.
- Avoid essay phrasing, lists read aloud, or corporate polish. It should sound like a friend who happens to know this stuff.

BEATS: the video is real footage, not text cards. Each beat has:
- "broll": a 2–5 word search phrase for real stock footage that matches the moment (e.g. "woman laughing kitchen", "doctor talking to patient", "hands holding coffee mug"). Everyday, human, non-graphic.
- "caption": the SHORT on-screen text for that beat (<= 45 chars) — punchy, lowercase-friendly, the kind of caption a real creator burns in.

Output — respond with ONLY a JSON object, no markdown fences:
{
  "script": "spoken voiceover, 90-140 words, opens strong, closes by pointing to a doctor / professional screening.",
  "hooks": ["exactly 3 opening-line hooks, <= 90 chars each, spoken style, none fear-based"],
  "beats": [ { "broll": "real footage search phrase", "caption": "short on-screen text" } ],  // 5 to 7 beats
  "caption": "2-4 sentence post caption, same voice, ends with a gentle save/share + talk-to-a-doctor CTA. No hashtags in the body.",
  "hashtags": ["3 to 5 lowercase hashtags, mix broad + niche"]
}`;

// ── Built-in fallback reels — spoken cadence + b-roll beats ──────────────────
const FALLBACK = {
  'mammogram-myths': {
    script: "Okay, real talk — let's kill a few myths that stress people out for no reason. Deodorant? It does not cause breast cancer. Neither does an underwire bra, or bumping your chest, or a phone in your pocket. None of it. The American Cancer Society is clear on this. What actually matters is way less dramatic: knowing your family history, and staying on top of screening as you get older. So if you've been quietly worried about your antiperspirant… let it go. And if you're not sure what screening you're due for, that's the real question — bring it to your doctor. That's the move.",
    hooks: [
      'Your deodorant is not giving you cancer. Promise.',
      'Let\'s kill three myths that stress everyone out.',
      'No, your underwire bra isn\'t the problem.',
    ],
    beats: [
      { broll: 'woman getting ready mirror', caption: 'myth check time' },
      { broll: 'deodorant morning routine',  caption: 'deodorant? no.' },
      { broll: 'bras on a rack',             caption: 'underwire? also no.' },
      { broll: 'family talking together',    caption: 'what matters: family history' },
      { broll: 'woman talking to doctor',    caption: 'and staying on top of screening' },
      { broll: 'phone calendar reminder',    caption: 'ask what you\'re due for' },
    ],
    caption: 'Deodorant, underwire, phone-in-your-pocket — none of it causes breast cancer (per the American Cancer Society). What actually helps: knowing your history and keeping up with screening. Save this and bring the screening question to your doctor.',
    hashtags: ['#breastcancerawareness', '#mythbusting', '#womenshealth', '#breasthealth'],
  },
  'first-mammogram': {
    script: "If your first mammogram is coming up and you're a little nervous — totally normal. Here's what actually happens, start to finish. You'll change into a gown. A tech, usually a woman, positions you one side at a time. There's a firm squeeze for a few seconds per image — uncomfortable, honestly, but quick. The whole thing? Usually under twenty minutes. That's it. You go back to your day. The nerves are almost always bigger than the appointment. So if you've been putting it off because of the unknown… now you know. Book it, and ask your doctor if it's the right time for you.",
    hooks: [
      'Nervous about your first mammogram? Here\'s the whole thing.',
      'What a mammogram is actually like — start to finish.',
      'The nerves are bigger than the appointment. Here\'s why.',
    ],
    beats: [
      { broll: 'woman waiting room calm',     caption: 'first mammogram?' },
      { broll: 'hospital gown hanging',       caption: 'you change into a gown' },
      { broll: 'friendly nurse smiling',      caption: 'a tech positions you' },
      { broll: 'clock ticking close up',      caption: 'a few seconds per image' },
      { broll: 'woman leaving clinic smiling',caption: 'under 20 minutes, done' },
      { broll: 'phone booking appointment',   caption: 'ask if it\'s your time' },
    ],
    caption: 'First mammogram nerves are real — but the appointment is usually under 20 minutes and over before you know it. If the unknown has kept you from booking, now you know. Ask your doctor if it\'s the right time for you.',
    hashtags: ['#mammogram', '#breastcancerawareness', '#earlydetection', '#womenshealth'],
  },
  'beyond-the-lump': {
    script: "Everyone knows to check for a lump — but a lump isn't the only thing worth noticing. So here's what else to keep an eye on. Skin that starts to dimple, almost like an orange peel. A nipple that suddenly pulls inward. Redness or scaling that doesn't clear up. Or any unusual discharge. None of these mean something's wrong — most of the time there's a harmless explanation. But they're all worth a quick mention to your doctor. You don't have to diagnose anything. Your only job is to notice a change… and let a professional take it from there.",
    hooks: [
      'A lump isn\'t the only thing to watch for.',
      'Nobody talks about these ones. Let\'s fix that.',
      'Beyond the lump: 4 changes worth a call.',
    ],
    beats: [
      { broll: 'woman thoughtful window light', caption: 'it\'s not just lumps' },
      { broll: 'orange peel texture macro',     caption: 'skin dimpling' },
      { broll: 'woman getting dressed morning',  caption: 'a nipple pulling inward' },
      { broll: 'person applying lotion skin',    caption: 'redness that won\'t clear' },
      { broll: 'woman talking on phone serious',  caption: 'worth a quick mention' },
      { broll: 'doctor reassuring patient',      caption: 'notice → tell your doctor' },
    ],
    caption: 'A lump isn\'t the only change worth noticing — skin dimpling, a nipple pulling inward, redness that won\'t clear, or unusual discharge are all worth a quick mention to your doctor. Not to diagnose — just to notice. Save and share.',
    hashtags: ['#breasthealth', '#knowyournormal', '#breastcancerawareness', '#earlydetection'],
  },
  'questions-for-doctor': {
    script: "Your next doctor's visit is a chance most of us waste — so here are three questions worth asking about your own risk. One: based on my history, when should I start or change my screening? Two: is my breast tissue dense, and does that change anything for me? Three: are there everyday habits that would actually lower my risk? That's it. Screenshot these, put them in your notes, whatever works. Because the goal isn't to worry about risk — it's to have a real conversation with someone who can look at your specific picture. Five minutes of questions is worth a lot of peace of mind.",
    hooks: [
      '3 questions to actually ask your doctor.',
      'Stop wasting your next appointment. Ask these.',
      'Screenshot these before your next check-up.',
    ],
    beats: [
      { broll: 'woman writing in notebook',    caption: 'before your next visit' },
      { broll: 'calendar screening schedule',  caption: '1. when should I screen?' },
      { broll: 'doctor reviewing scan',        caption: '2. is my tissue dense?' },
      { broll: 'person walking outdoors',      caption: '3. what lowers my risk?' },
      { broll: 'phone taking screenshot',      caption: 'screenshot these' },
      { broll: 'patient doctor conversation',  caption: '5 mins = real peace of mind' },
    ],
    caption: 'Three questions turn a routine check-up into a real risk conversation: when to screen, whether your tissue is dense, and what everyday habits help. Screenshot these for your next appointment — and talk it through with your doctor.',
    hashtags: ['#breastcancerawareness', '#knowyourrisk', '#womenshealth', '#screening'],
  },
  'men-get-it-too': {
    script: "Here's one that surprises almost everyone: men get breast cancer too. It's rare — the American Cancer Society says it's about one percent of all breast cancer cases — but it's real, and because so few people expect it, it often gets caught later. Men have breast tissue too, so the same changes matter: a lump, skin dimpling, or a nipple that pulls in. This isn't about scaring anyone. It's just that awareness saves time, and time matters. So if something feels off, don't brush it off because you're a guy. Same rule for everyone — notice a change, and talk to your doctor.",
    hooks: [
      'Wait — men get breast cancer too?',
      'The 1% nobody talks about.',
      'This one surprises almost everyone.',
    ],
    beats: [
      { broll: 'man thinking coffee window',   caption: 'men get it too' },
      { broll: 'group of men laughing',        caption: '~1% of cases (per ACS)' },
      { broll: 'man checking phone serious',   caption: 'often caught later' },
      { broll: 'man talking to doctor',        caption: 'same changes matter' },
      { broll: 'hands on chest gesture',       caption: 'lump, dimpling, nipple change' },
      { broll: 'man on phone booking',         caption: 'notice → tell your doctor' },
    ],
    caption: 'Men get breast cancer too — about 1% of cases (per the American Cancer Society) — and because it\'s unexpected, it\'s often caught later. Same changes to watch for, same rule: notice something, talk to your doctor. Share this with the men in your life.',
    hashtags: ['#malebreastcancer', '#breastcancerawareness', '#menshealth', '#earlydetection'],
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
  if (typeof reel.script !== 'string' || wc < 80 || wc > 150) errs.push(`script must be ~90-140 words, got ${wc}`);
  if (!Array.isArray(reel.hooks) || reel.hooks.length !== 3) errs.push(`hooks must be exactly 3, got ${reel.hooks?.length}`);
  if ((reel.hooks || []).some(h => typeof h !== 'string' || !h.trim() || h.length > 100)) errs.push('each hook must be a non-empty string <= 100 chars');
  if (!Array.isArray(reel.beats) || reel.beats.length < 5 || reel.beats.length > 7) errs.push(`beats must be 5-7, got ${reel.beats?.length}`);
  if ((reel.beats || []).some(b => !b || typeof b.broll !== 'string' || !b.broll.trim() || typeof b.caption !== 'string' || !b.caption.trim() || b.caption.length > 55)) {
    errs.push('each beat needs a broll phrase + a caption <= 55 chars');
  }
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

  if (!FORCE && current.reels.some(r => r.weekOf === weekOf)) {
    console.log(`Reels for week ${weekOf} already exist in state.json — nothing to do. (Use --force to regenerate.)`);
    return;
  }
  if (FORCE) {
    current.reels = current.reels.filter(r => r.weekOf !== weekOf);
    reelsState.save(current);
    console.log(`--force: cleared existing reels for week ${weekOf}.`);
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
      beats:     content.beats,
      caption:   content.caption,
      hashtags:  content.hashtags,
      voiceover: true, // build --no-vo flips to a captions-only bundle
      source,
      status:    'pending',
      createdAt: new Date().toISOString(),
    });
    console.log(`  ✓ ${SLOT_DAYS[i]} · ${topic.key} · ${wordCount(content.script)}w spoken, 3 hooks, ${content.beats.length} beats (${source})`);
  }

  if (DRY_RUN) {
    console.log(JSON.stringify(reels, null, 2));
    console.log('Dry run — state.json untouched.');
    return;
  }

  reelsState.addReels(reels);
  console.log(`Done — ${reels.length} pending reels written. Next: node scripts/publish-reels-review.js`);
}

main().catch(err => {
  console.error(`writer-reels failed: ${err.message}`);
  process.exit(1);
});
