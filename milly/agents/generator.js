'use strict';

// generator — content creation agent
// runs Monday 8am MT after researcher
// makes 4 separate Claude API calls (one per content piece — quality drops when batched)
// saves output to /output/content/content-[YYYY-MM-DD].json

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude = require('../lib/claude');
const store  = require('../lib/store');
const fs     = require('fs');
const path   = require('path');

// load inspiration sources — used to inform themes, never copied directly
function loadInspirationThemes() {
  const sourcesPath = path.join(__dirname, '..', 'templates', 'inspiration-sources.json');
  if (!fs.existsSync(sourcesPath)) return '';
  const sources = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
  const themes = sources.recurring_themes || [];
  return themes.length
    ? `Proven content themes from the speaking industry (use as inspiration, never copy directly):\n${themes.map(t => `- ${t}`).join('\n')}`
    : '';
}

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

IMPORTANT — quality bar:
- Be specific. Name real situations: "your speaker page has no demo reel", "you pitched 3 events this quarter and heard nothing back", "event planners open speaker one-sheets for 8 seconds on average."
- Use numbers wherever you can. Real-feeling stats build credibility.
- Write like a cynical industry insider who has seen every mistake speakers make.
- Every slide should make a speaker feel a micro-pang of recognition — "that's me."
- No generic motivational language. No filler. No observations speakers already know.

Rules:
- Slide 1: hook — one punchy statement that makes a speaker feel called out. Max 10 words. Body is empty string.
- Slides 2-5: deliver the insight. One specific, actionable idea per slide. Max 8 words headline, max 25 words body. Concrete example or number on each slide.
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

IMPORTANT — quality bar:
- Open with a single line that feels like a gut punch of recognition. Not "Most speakers…" — something more specific and cinematic. Example: "You delivered the best talk of your career. Nobody knew your name two weeks later."
- Each short paragraph should land a new specific observation — not a vague generalization.
- Reference concrete scenarios: the email that sat unread for 11 days, the event planner who booked someone with half your experience, the demo reel nobody watched.
- Write like an insider who has watched hundreds of speakers plateau. Sharp. Not harsh — honest.
- The caption should make the reader feel understood before it tells them what to do.

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

IMPORTANT — quality bar:
- Open with a specific concrete finding: the event name, a deadline date, the speaker fee range, the topic gap they're trying to fill. Make it feel like surveillance — Reeve is scanning events so speakers don't have to.
- Include at least 2 real-feeling specifics: an audience size, a city, a deadline, a fee, a stated topic need.
- The tone is efficient, professional, proof-of-work. Not inspirational. Just: this is what we found. This is the gap. Can you fill it?
- The implicit message: you would have missed this. We didn't.

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

IMPORTANT — quality bar:
- [HOOK - 2 sec]: must be a pattern interrupt. Not a question — a statement that sounds like it's talking directly to the viewer. Something specific they recognize from their own experience: "You've given 40 talks. You still don't have a booking manager." That's the bar.
- [BODY - 12 sec]: short punchy sentences that stack. Each one adds a new piece of evidence. No filler, no transitions. Write like a voice memo from someone who knows too much.
- B-roll suggestions should be specific and visual: "close-up of an unopened email from an event organizer", "speaker at podium, crowd barely visible", not just "speaking at event."
- The script should feel urgent, slightly uncomfortable, and immediately shareable.

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

  const brandVoice       = store.getBrandVoice();
  const weekNiches       = store.getWeekNiches();
  const inspirationThemes = loadInspirationThemes();
  const voiceContext     = buildVoiceContext(brandVoice) + (inspirationThemes ? `\n\n${inspirationThemes}` : '');
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

  // Enhancement B: generate 2 caption variants (different hook, same angle)
  // scheduler picks A or B alternating weekly via ab-tracker
  console.log('Generating caption variants A and B...');
  let caption1A, caption1B;
  if (captionAngle.prewrittenContent) {
    const prc = captionAngle.prewrittenContent;
    const cleanBody = prc.body.replace(/\s*—\s*Reeve\s*$/i, '').trimEnd();
    caption1A = `${prc.hook}\n\n${cleanBody}\n\n— Reeve\n\n${prc.hashtags.join(' ')}`;
    caption1B = caption1A; // evergreen content has one version; duplicate is fine
  } else {
    caption1A = await generateCaption(captionAngle, weekNiches.caption, voiceContext);
    caption1B = await generateCaption({ ...captionAngle, angle: captionAngle.angle + ' (alternate angle)' }, weekNiches.caption, voiceContext);
  }
  caption1 = caption1A; // default — scheduler overrides based on ab-tracker
  console.log('Caption variants done.');

  console.log('Generating Reeve found post...');
  if (reeveFoundAngle.prewrittenContent) {
    const prc = reeveFoundAngle.prewrittenContent;
    const cleanRfBody = prc.body.replace(/\s*(That['']s the job\.\s*)?—\s*Reeve\s*$/i, '').trimEnd();
    reeveFound = `${prc.hook}\n\n${cleanRfBody}\n\nThat's the job. — Reeve\n\n${prc.hashtags.slice(0, 3).join(' ')}`;
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
      caption1:   { body: caption1A, variantA: caption1A, variantB: caption1B },
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
