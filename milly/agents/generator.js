'use strict';

// generator — content creation agent
// runs Monday 8am MT after researcher
// makes 4 separate Claude API calls (one per content piece — quality drops when batched)
// saves output to /output/content/content-[YYYY-MM-DD].json

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude = require('../lib/claude');
const store  = require('../lib/store');

// build the shared voice context string injected into every Claude call
function buildVoiceContext(brandVoice) {
  return `Brand: ${brandVoice.brand} (${brandVoice.instagram_handle})
Audience: ${brandVoice.audience}
Core pain: ${brandVoice.core_pain}
Tone: ${brandVoice.tone}
Casing: ${brandVoice.casing}
Avoid words: ${brandVoice.avoid_words.join(', ')}
Sentence style: ${brandVoice.sentence_style}
CTA style: ${brandVoice.cta_style}
Attribution: posts end with "${brandVoice.post_attribution}"
Never mention AI in any form.`;
}

// call 1 — 6-slide carousel (booking niche)
async function generateCarousel(angle, voiceContext) {
  const prompt = `You are writing Instagram carousel content for Reeve, a speaker booking agency.

Voice and rules:
${voiceContext}

This week's angle: ${angle.angle}
Pain point: ${angle.painPoint}
Data point: ${angle.dataPoint || 'none'}

Write a 6-slide carousel. Return as JSON array only — no markdown, no preamble.
Format: [{"slide": 1, "headline": "", "body": ""}]

Rules:
- Slide 1: hook — make a speaker stop scrolling. One punchy statement as headline. Body is empty string.
- Slides 2-5: deliver the insight. One idea per slide. Max 8 words headline, max 20 words body. Sentence case.
- Slide 6: soft CTA. Headline: "Ready to stop waiting?" Body: "Reeve handles the pitching. You just show up and speak. DM us the word stages."
- Never use any word from the avoid list.
- Return only the JSON array. No explanation before or after.`;

  const raw  = await claude.call({ prompt, maxTokens: 2000 });
  const slides = claude.parseJson(raw);

  // build caption for the carousel post from slide 1 hook
  const hookLine = slides[0]?.headline || angle.hook;
  const caption  = `${hookLine}\n\nSwipe to see the full breakdown.\n\n#publicspeaking #speakingbusiness #speakerlife`;

  return { slides, caption };
}

// call 2 — pain-point caption (mindset or automation niche, alternates weekly)
async function generateCaption(angle, niche, voiceContext) {
  const prompt = `You are writing an Instagram caption for Reeve, a speaker booking agency.

Voice and rules:
${voiceContext}

Angle: ${angle.angle}
Niche: ${niche}

Write a caption that opens with a single line that stops a speaker mid-scroll.
100-150 words. Sentence case. Short paragraphs, 1-2 sentences max.
End with: "— Reeve"
Add exactly 3-5 hashtags from this list at the very end (new line): #publicspeaking #speakingbusiness #speakerlife #keynote #thoughtleadership
Return as plain text only. No JSON, no markdown.`;

  return claude.call({ prompt, maxTokens: 1000 });
}

// call 3 — "Reeve found this" post (booking niche, shows agency doing its job)
async function generateReeveFound(conferences, voiceContext) {
  const conferenceText = conferences.length
    ? conferences.map(c => `- ${c.name}${c.deadline ? ` (deadline: ${c.deadline})` : ''}${c.topic ? ` — topic: ${c.topic}` : ''}`).join('\n')
    : 'none found this week — use a realistic hypothetical (regional leadership conference, industry trade show, online summit)';

  const prompt = `You are writing an Instagram caption for Reeve, a speaker booking agency.

Voice and rules:
${voiceContext}

Conferences and opportunities found this week:
${conferenceText}

Write a post that shows Reeve doing its job — finding real speaking opportunities.
Do NOT name specific clients. Reference real conference types or topics found.
Demonstrate the value of having a systematic booking pipeline.
80-120 words. Sentence case. End with: "That's the job. — Reeve"
Add exactly 3 hashtags from this list at the very end: #publicspeaking #speakingbusiness #speakerlife
Return as plain text only. No JSON, no markdown.`;

  return claude.call({ prompt, maxTokens: 1000 });
}

// call 4 — 20-second reel script (automation or mindset niche, alternates weekly)
async function generateReelScript(angle, niche, voiceContext) {
  const prompt = `You are writing a 20-second Instagram Reel script for Reeve, a speaker booking agency.

Voice and rules:
${voiceContext}

Angle: ${angle.angle}
Niche: ${niche}

Structure (label each section exactly as shown):
[HOOK - 2 sec]: pattern interrupt. A speaker hears this and thinks "that's me."
[BODY - 12 sec]: deliver the insight fast. Short sentences. No filler.
[CTA - 6 sec]: soft. "DM us the word stages" or "link in bio."
Include [B-ROLL NOTE: suggestion] inline where relevant.
Under 60 spoken words total.
Return as plain text script only. No JSON, no markdown.`;

  return claude.call({ prompt, maxTokens: 1000 });
}

// extract the hook line from a reel script (first non-empty line after [HOOK])
function extractReelHook(script) {
  const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
  const hookIdx = lines.findIndex(l => l.toLowerCase().includes('[hook'));
  if (hookIdx >= 0 && lines[hookIdx + 1]) {
    return lines[hookIdx + 1].replace(/^\[B-ROLL.*?\]\s*/i, '').trim();
  }
  return lines[0] || 'Most speakers are invisible — and they don\'t know it.';
}

async function main() {
  const brief = store.getLatestBrief();
  if (!brief) {
    console.error('No research brief found. Run node agents/researcher.js first.');
    process.exit(1);
  }

  const brandVoice   = store.getBrandVoice();
  const weekNiches   = store.getWeekNiches();
  const voiceContext = buildVoiceContext(brandVoice);
  const { angles, conferencesFound, weekOf } = brief;

  console.log(`Generating content for week of ${weekOf}.`);
  console.log(`Niches this week — caption: ${weekNiches.caption}, reel: ${weekNiches.reel}`);

  // pick angles by type — fall back to first available if specific ones missing
  const carouselAngle    = angles.find(a => a.niche === 'booking') || angles[0];
  const captionAngle     = angles.find(a => a.niche === weekNiches.caption) || angles[1] || angles[0];
  const reeveFoundAngle  = angles.find(a => a.suggestedFormat === 'reeve_found' || a.suggestedFormat === 'reevefound') || angles[3] || angles[0];
  const reelAngle        = angles.find(a => a.niche === weekNiches.reel) || angles[2] || angles[0];

  // if the brief came from evergreen with pre-written content, use it directly
  // otherwise generate via Claude API
  let carousel, caption1, reeveFound, reelScript;

  console.log('Generating carousel...');
  if (carouselAngle.prewrittenContent) {
    const prc = carouselAngle.prewrittenContent;
    carousel = {
      slides:  [{ slide: 1, headline: prc.hook, body: '' }, { slide: 2, headline: 'Full breakdown', body: prc.body }],
      caption: `${prc.hook}\n\n${prc.hashtags.join(' ')}`,
    };
  } else {
    carousel = await generateCarousel(carouselAngle, voiceContext);
  }
  console.log('Carousel done.');

  console.log('Generating caption...');
  if (captionAngle.prewrittenContent) {
    const prc = captionAngle.prewrittenContent;
    caption1 = `${prc.hook}\n\n${prc.body}\n\n— Reeve\n\n${prc.hashtags.join(' ')}`;
  } else {
    caption1 = await generateCaption(captionAngle, weekNiches.caption, voiceContext);
  }
  console.log('Caption done.');

  console.log('Generating Reeve found post...');
  if (reeveFoundAngle.prewrittenContent) {
    const prc = reeveFoundAngle.prewrittenContent;
    reeveFound = `${prc.hook}\n\n${prc.body}\n\nThat's the job. — Reeve\n\n${prc.hashtags.slice(0, 3).join(' ')}`;
  } else {
    reeveFound = await generateReeveFound(conferencesFound || [], voiceContext);
  }
  console.log('Reeve found post done.');

  console.log('Generating reel script...');
  if (reelAngle.prewrittenContent) {
    const prc = reelAngle.prewrittenContent;
    reelScript = `[HOOK - 2 sec]: ${prc.hook}\n\n[BODY - 12 sec]: ${prc.body}\n\n[CTA - 6 sec]: DM us the word stages.`;
  } else {
    reelScript = await generateReelScript(reelAngle, weekNiches.reel, voiceContext);
  }
  console.log('Reel script done.');

  // advance the weekly rotation counter so next week alternates niches
  store.advanceWeekRotation();

  const content = {
    weekOf,
    generatedAt: new Date().toISOString(),
    niches:      weekNiches,
    posts: {
      carousel:   { slides: carousel.slides, caption: carousel.caption },
      caption1:   { body: caption1 },
      reevefound: { body: reeveFound },
      reel:       { script: reelScript, hookLine: extractReelHook(reelScript) },
    },
  };

  const filePath = store.savePost(content);
  console.log(`Content generation complete. 4 posts saved to: ${filePath}`);
}

main().catch(err => {
  console.error(`Generator failed: ${err.message}`);
  process.exit(1);
});
