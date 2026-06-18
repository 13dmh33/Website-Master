'use strict';

// generator — Molly content generation agent
// reads the weekly research brief and generates 4 posts:
//   carousel (education), caption (results/education), trevo_found (product), reel (results/journey)
// saves to output/content/content-[YYYY-MM-DD].json

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude   = require('../lib/claude');
const store    = require('../lib/store');
const glossary = require('../lib/glossary');

function buildVoiceContext(brandVoice, glossaryTerms) {
  const tone     = brandVoice?.tone || 'direct, results-focused, credible';
  const avoid    = (brandVoice?.avoid_words || []).join(', ');
  const casing   = brandVoice?.casing || 'sentence case always';
  const glossCtx = glossary.formatForPrompt(glossaryTerms);

  return `Brand: Trevo Advisors (@trevoadvisors)
Audience: home service contractors (plumbers, electricians, roofers, handymen) who need professional websites
Tone: ${tone}
Casing: ${casing}
Never use these words: ${avoid}
Never mention AI, bots, or automation tools — speak about the website and the results it drives
End posts with "— Trevo" attribution
${glossCtx}`;
}

async function generateCarousel(angle, voiceContext) {
  const prompt = `${voiceContext}

You are writing a 5-slide Instagram carousel for Trevo Advisors — a website agency serving home service contractors.

Topic angle: ${angle.angle}
Niche: ${angle.niche}
Core pain: ${angle.painPoint}
${angle.dataPoint ? `Data/context: ${angle.dataPoint}` : ''}
${angle.glossarySeed ? `Industry term to use: ${angle.glossarySeed.term} — ${angle.glossarySeed.angle}` : ''}

Write 5 slides. Slide 1 is the hook — make a contractor stop scrolling. Slides 2-4 are educational points. Slide 5 is a soft CTA.
Also write a 60-100 word Instagram caption for the carousel post.

Return valid JSON only:
{
  "slides": [
    {"headline": "...", "body": "..."},
    {"headline": "...", "body": "..."},
    {"headline": "...", "body": "..."},
    {"headline": "...", "body": "..."},
    {"headline": "...", "body": "..."}
  ],
  "caption": "..."
}`;

  const raw    = await claude.call({ prompt, maxTokens: 1200 });
  return claude.parseJson(raw);
}

async function generateCaption(angle, voiceContext, niche) {
  const iResults = niche === 'results';
  const prompt   = `${voiceContext}

You are writing a single-image Instagram caption for Trevo Advisors about contractor website marketing.

Niche this week: ${niche}
${iResults ? 'This is a results post — describe a contractor who got more calls after launching a website (no specific names or identifying details).' : 'This is an education post — explain why contractors are losing business without a website.'}
Core pain: ${angle.painPoint}
Hook angle: ${angle.hook}

Requirements:
- Open with a one-line hook that makes a contractor stop scrolling
- 100-150 words total
- Short paragraphs (1-2 sentences max)
- End with "— Trevo"
- CTA: "link in bio"

Also write a variant B caption with a different opening hook on the same theme.

Return valid JSON only:
{
  "variantA": "full caption text...",
  "variantB": "full caption text with different hook..."
}`;

  const raw = await claude.call({ prompt, maxTokens: 800 });
  return claude.parseJson(raw);
}

async function generateTrevoFound(angle, voiceContext) {
  // Rotate between demo site updates and AI agent product updates
  const DEMOS = [
    { trade: 'plumbing',    url: 'trevoadvisors.com/demos/plumbing/',    features: ['Tap-to-call above the fold', 'Emergency service page', 'Google reviews live', 'Service area map', 'Trust badges — licensed & insured', '48-hour build'] },
    { trade: 'electrical',  url: 'trevoadvisors.com/demos/electrical/',  features: ['Tap-to-call above the fold', 'Panel upgrade service page', 'Google reviews live', 'Service area map', 'Trust badges — licensed & insured', '48-hour build'] },
    { trade: 'handyman',    url: 'trevoadvisors.com/demos/handyman/',    features: ['Tap-to-call above the fold', 'Service menu with photos', 'Google reviews live', 'Instant quote request form', 'Trust badges', '48-hour build'] },
  ];
  const AGENTS = [
    { name: 'Nora', tagline: 'AI lead follow-up agent', url: 'trevoadvisors.com/start/', features: ['Texts new leads in under 60 seconds', 'Follows up 3x without you lifting a finger', 'Hands off hot leads with full context', 'Works while you\'re on the job', '$65/mo — no contracts', 'Pairs with any Trevo website'] },
    { name: 'Atlas', tagline: 'AI lead pipeline manager', url: 'trevoadvisors.com/atlas/', features: ['Scores and sorts leads by close probability', 'Sends personalized follow-up sequences', 'Flags high-value jobs for you', 'Dashboard to see pipeline at a glance', '$65/mo — no contracts', 'Add-on to your Trevo site'] },
    { name: 'Argus', tagline: 'AI review responder', url: 'trevoadvisors.com/argus/', features: ['Responds to every Google review automatically', 'Flags negative reviews for human review', 'Keeps your profile active for SEO', 'Sounds like you — not generic AI copy', '$65/mo — no contracts', 'Works on any Google Business Profile'] },
  ];

  // Alternate: odd weeks → demo, even weeks → agent
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const useAgent = weekNum % 2 === 0;

  if (useAgent) {
    const agent = AGENTS[weekNum % AGENTS.length];
    const prompt = `${voiceContext}

Write an Instagram product update post for Trevo Advisors introducing ${agent.name} — ${agent.tagline}.

Requirements:
- Open with "We just launched ${agent.name}. Here's what it does."
- List what ${agent.name} does in 4-6 punchy lines (use the features below as a guide)
- Mention the price: $65/mo, no contracts
- End with "That's ${agent.name}. — Trevo" followed by "DM us the word demo."
- 80-120 words total
- Tone: direct, not salesy

Features to reference: ${agent.features.join(', ')}

Also write the hook line only (max 12 words) for a product reveal image.

Return valid JSON only:
{
  "body": "full post text...",
  "hookLine": "short hook for image..."
}`;

    const raw    = await claude.call({ prompt, maxTokens: 600 });
    const result = claude.parseJson(raw);
    return { ...result, type: 'agent', name: agent.name, tagline: agent.tagline, url: agent.url, features: agent.features };
  } else {
    const demo  = DEMOS[weekNum % DEMOS.length];
    const prompt = `${voiceContext}

Write an Instagram post showing off Trevo's ${demo.trade} contractor demo website.

Requirements:
- Open with "We just updated our ${demo.trade} demo site. Here's what's inside."
- List 4-6 specific features of the demo site
- Mention contractors can view the live demo at ${demo.url}
- End with "That's the build. — Trevo" followed by "DM us the word demo."
- 80-120 words total
- Tone: direct, results-focused

Features to reference: ${demo.features.join(', ')}

Also write the hook line only (max 12 words) for a site reveal image.

Return valid JSON only:
{
  "body": "full post text...",
  "hookLine": "short hook for image..."
}`;

    const raw    = await claude.call({ prompt, maxTokens: 600 });
    const result = claude.parseJson(raw);
    return { ...result, type: 'demo', trade: demo.trade, url: demo.url, features: demo.features };
  }
}

async function generateReelScript(angle, voiceContext, niche) {
  const prompt = `${voiceContext}

You are writing a 20-second Instagram reel script for Trevo Advisors.

Niche this week: ${niche}
${niche === 'results' ? 'Show a contractor before and after getting a website — more calls, more jobs.' : 'Show behind-the-scenes of how Trevo builds a contractor site in 48 hours.'}
Hook angle: ${angle.hook}

Format: HOOK (0-2s), BODY (2-14s), CTA (14-20s)
Include b-roll notes inline in brackets.
Under 60 spoken words total.
CTA: "DM us the word demo."
End with "— Trevo"

Also write the hook line only (max 12 words) for a reel hook image.

Return valid JSON only:
{
  "script": "HOOK (0-2s): ...\n[B-roll: ...]\n\nBODY (2-14s): ...\n[B-roll: ...]\n\nCTA (14-20s): ...\n— Trevo",
  "hookLine": "short hook line for image...",
  "caption": "60-word or less caption for the reel post"
}`;

  const raw = await claude.call({ prompt, maxTokens: 700 });
  return claude.parseJson(raw);
}

async function main() {
  const brief = store.getLatestBrief();
  if (!brief) {
    console.error('No research brief found. Run node agents/researcher.js first.');
    process.exit(1);
  }

  const brandVoice    = store.getBrandVoice() || {};
  const { caption: captionNiche, reel: reelNiche, weekNumber } = store.getWeekNiches();
  const glossaryTerms = glossary.getWeeklyTerms(3);

  console.log(`Generator running for week of ${brief.weekOf}.`);
  console.log(`Caption niche: ${captionNiche} | Reel niche: ${reelNiche} | Week rotation: ${weekNumber}`);

  const voiceContext = buildVoiceContext(brandVoice, glossaryTerms);
  const angles       = brief.angles || [];

  // use prewritten evergreen content if available (researcher set it on evergreen fallback)
  const carouselAngle     = angles.find(a => a.suggestedFormat === 'carousel')     || angles[0] || {};
  const captionAngle      = angles.find(a => a.suggestedFormat === 'caption')      || angles[1] || {};
  const trevoFoundAngle   = angles.find(a => a.suggestedFormat === 'trevo_found')  || angles[2] || {};
  const reelAngle         = angles.find(a => a.suggestedFormat === 'reel')         || angles[3] || {};

  const posts = {};

  // 1. carousel
  console.log('Generating carousel...');
  if (carouselAngle.prewrittenContent) {
    const slides = (carouselAngle.prewrittenContent.body || '').split('\n')
      .filter(l => l.startsWith('Slide '))
      .map(l => {
        const colonIdx = l.indexOf(':');
        return { headline: l.slice(0, colonIdx).trim(), body: l.slice(colonIdx + 1).trim() };
      });
    posts.carousel = {
      slides: slides.length ? slides : [{ headline: carouselAngle.hook, body: '' }],
      caption: `${carouselAngle.hook}\n\nDM us the word demo.\n\n${carouselAngle.prewrittenContent.hashtags || ''}`,
    };
  } else {
    posts.carousel = await generateCarousel(carouselAngle, voiceContext);
  }
  console.log('Carousel done.');

  // 2. caption (A/B variants)
  console.log('Generating caption...');
  if (captionAngle.prewrittenContent) {
    posts.caption1 = {
      variantA: captionAngle.prewrittenContent.body,
      variantB: captionAngle.prewrittenContent.body,
      body:     captionAngle.prewrittenContent.body,
    };
  } else {
    const captionResult = await generateCaption(captionAngle, voiceContext, captionNiche);
    posts.caption1 = {
      ...captionResult,
      body: captionResult.variantA,
    };
  }
  console.log('Caption done.');

  // 3. trevo_found
  console.log('Generating trevo_found...');
  if (trevoFoundAngle.prewrittenContent) {
    posts.trevo_found = {
      body:     trevoFoundAngle.prewrittenContent.body,
      hookLine: trevoFoundAngle.hook,
    };
  } else {
    posts.trevo_found = await generateTrevoFound(trevoFoundAngle, voiceContext);
  }
  console.log('Trevo found done.');

  // 4. reel
  console.log('Generating reel script...');
  if (reelAngle.prewrittenContent) {
    posts.reel = {
      script:   reelAngle.prewrittenContent.body,
      hookLine: reelAngle.hook,
      caption:  reelAngle.prewrittenContent.body.split('\n')[0] || reelAngle.hook,
    };
  } else {
    posts.reel = await generateReelScript(reelAngle, voiceContext, reelNiche);
  }
  console.log('Reel done.');

  const contentData = {
    weekOf:       brief.weekOf,
    generatedAt:  new Date().toISOString(),
    researchMode: brief.researchMode,
    niches:       { caption: captionNiche, reel: reelNiche },
    posts,
    glossaryTerms: glossaryTerms.map(t => t.term),
  };

  const filePath = store.savePost(contentData);
  store.advanceWeekRotation();

  console.log(`\nContent generation complete for week of ${brief.weekOf}.`);
  console.log(`4 posts saved to: ${filePath}`);
  console.log(`Next: node agents/designer.js`);
}

main().catch(err => {
  console.error(`Generator failed: ${err.message}`);
  process.exit(1);
});
