'use strict';

// one-time script: generate 10 evergreen posts via Claude API and save to templates/evergreen.json
// run once at setup: node scripts/generate-evergreen.js
// re-run any time you want fresh evergreen content

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude = require('../lib/claude');
const store  = require('../lib/store');

const TOPICS = [
  { id: 'ev-01', niche: 'booking',    format: 'carousel',    topic: 'the 3 things event organizers read first in a speaker pitch' },
  { id: 'ev-02', niche: 'mindset',    format: 'caption',     topic: 'why most speakers only get booked once at the same event' },
  { id: 'ev-03', niche: 'booking',    format: 'caption',     topic: 'unpaid speaking gigs — when they\'re worth it and when they\'re not' },
  { id: 'ev-04', niche: 'booking',    format: 'reevefound',  topic: 'how to find conferences looking for speakers right now' },
  { id: 'ev-05', niche: 'mindset',    format: 'caption',     topic: 'what separates speakers who get callbacks from those who don\'t' },
  { id: 'ev-06', niche: 'booking',    format: 'carousel',    topic: 'the speaker pipeline problem nobody talks about' },
  { id: 'ev-07', niche: 'mindset',    format: 'caption',     topic: 'why your speaker bio is losing you bookings' },
  { id: 'ev-08', niche: 'automation', format: 'caption',     topic: 'how systematic pitching is changing who gets booked to speak in 2026' },
  { id: 'ev-09', niche: 'mindset',    format: 'caption',     topic: 'the follow-up rule most speakers ignore after they speak' },
  { id: 'ev-10', niche: 'booking',    format: 'carousel',    topic: 'building a speaking pipeline: what it actually looks like' },
];

const SYSTEM_PROMPT = `You are writing Instagram content for Reeve, a speaker booking agency.
Rules:
- Sentence case always. Never title case. Never all caps.
- Short punchy sentences. One idea per line where possible.
- Never use: unlock, game-changer, supercharge, leverage, hustle, crush it, kill it, dominate, hack, secret, AI, automated, bot.
- Never mention AI or automation as technology — speak about systems and process instead.
- Audience: coaches, consultants, authors, executives who have spoken at a few events and want more.
- Core pain: they wait to be invited instead of pitching proactively.
- Attribution: always end captions with "— Reeve"
- Return JSON only. No markdown, no preamble, no explanation.`;

async function generatePost(item) {
  const prompt = `Topic: "${item.topic}"
Niche: ${item.niche}
Format: ${item.format}

Write an Instagram post on this topic for Reeve, a speaker booking agency.

Return as JSON with this shape:
{
  "hook": "the opening line — makes a speaker stop scrolling",
  "body": "the full post body text (100-150 words for captions, shorter for reel). Sentence case. Short paragraphs.",
  "hashtags": ["#publicspeaking", "#speakingbusiness", "#speakerlife"]
}

For carousel format, make the hook punchy and the body a 5-point list that works as slide text.
For reevefound format, write as if Reeve found a real opportunity — specific, concrete, useful.
Use exactly 3-5 hashtags from this list: #publicspeaking #speakingbusiness #speakerlife #keynote #thoughtleadership`;

  const raw = await claude.call({ prompt, systemPrompt: SYSTEM_PROMPT, maxTokens: 600 });
  const parsed = claude.parseJson(raw);
  return {
    ...item,
    hook:      parsed.hook,
    body:      parsed.body,
    hashtags:  parsed.hashtags,
    used:      false,
    lastUsed:  null,
  };
}

async function main() {
  console.log('Generating evergreen content bank...');

  const existing = store.getEvergreen();
  if (existing && existing.generated && existing.posts && existing.posts.length > 0) {
    console.log(`Evergreen bank already has ${existing.posts.length} posts. Pass --force to regenerate.`);
    if (!process.argv.includes('--force')) {
      process.exit(0);
    }
  }

  const posts = [];
  for (const topic of TOPICS) {
    process.stdout.write(`  Generating ${topic.id} (${topic.topic.slice(0, 50)}...)...`);
    try {
      const post = await generatePost(topic);
      posts.push(post);
      console.log(' done.');
    } catch (err) {
      console.error(` failed: ${err.message}`);
    }
    // small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 800));
  }

  store.saveEvergreen({ generated: true, generatedAt: new Date().toISOString(), posts });
  console.log(`\nEvergreen bank saved. ${posts.length} posts ready.`);
  console.log('Location: templates/evergreen.json\n');
}

main().catch(err => {
  console.error(`Generate evergreen failed: ${err.message}`);
  process.exit(1);
});
