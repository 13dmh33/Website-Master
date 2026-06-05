'use strict';

// generate-evergreen — uses Claude to expand the evergreen content bank
// run when the bank runs low (< 4 unused posts)
// appends new posts to templates/evergreen.json without overwriting existing ones
// estimated cost: ~$0.01 for 20 posts at Haiku rates

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const claude = require('../lib/claude');
const store  = require('../lib/store');

// HVAC excluded — owner works for HVAC manufacturer (conflict of interest)
// Primary focus: plumbing (40%), electrical (35%), handyman (25%)
const TRADES = ['plumbing', 'electrical', 'handyman', 'plumbing', 'roofing'];
const FORMATS = ['carousel', 'caption', 'trevo_found', 'reel'];
const NICHES  = {
  carousel:    'education',
  caption:     'results',
  trevo_found: 'product',
  reel:        'journey',
};

async function generatePost(format, trade) {
  const niche = NICHES[format];
  const prompt = `You are Molly, a social media content engine for Trevo Advisors — a website agency for home service contractors.

Write one evergreen Instagram ${format} post for the ${niche} niche, focused on ${trade} contractors.

Format requirements:
${format === 'carousel' ? `- Hook line (stops a contractor scrolling)
- 4 additional slide bodies (slide 1 headline, slides 2-5 body text)
- Caption for the post (60-100 words, ends with "DM us the word demo.")` : ''}
${format === 'caption' ? `- 100-150 word caption (results or education niche)
- Opens with a hook line
- Short paragraphs
- Ends with "— Trevo"` : ''}
${format === 'trevo_found' ? `- 80-120 words
- Opens with "Trevo just built a [trade] site in [city]."
- Lists 4-6 specific features
- Ends with "That's the build. — Trevo\nDM us the word demo."` : ''}
${format === 'reel' ? `- 20-second reel script format: HOOK (0-2s), BODY (2-14s), CTA (14-20s)
- Include b-roll notes in brackets
- Under 60 spoken words
- Ends with "— Trevo"` : ''}

Tone: direct, results-focused, never salesy. Sentence case. No buzzwords.

Return valid JSON only:
{
  "hook": "one-line hook for the post",
  "body": "full post text",
  "hashtags": "#relevant #hashtags #for #post"
}`;

  const raw    = await claude.call({ prompt, maxTokens: 600 });
  const result = claude.parseJson(raw);
  return { format, niche, trade, ...result };
}

async function main() {
  const existing = store.getEvergreen() || { posts: [] };
  const count    = existing.posts.length;
  const unused   = existing.posts.filter(p => !p.used).length;

  console.log(`Evergreen bank: ${count} total, ${unused} unused.`);

  const targetNew = 20;
  console.log(`Generating ${targetNew} new posts...`);

  const newPosts = [];
  let idx        = count;

  for (const format of FORMATS) {
    for (let i = 0; i < 5; i++) {
      const trade = TRADES[i % TRADES.length];
      const id    = `ev-${format}-${String(idx + 1).padStart(2, '0')}`;
      console.log(`  Generating ${id} (${format}/${trade})...`);

      try {
        const post = await generatePost(format, trade);
        newPosts.push({ id, ...post, used: false });
        idx++;
      } catch (err) {
        console.warn(`  Skipped ${id}: ${err.message}`);
      }
    }
  }

  existing.posts = [...existing.posts, ...newPosts];
  store.saveEvergreen(existing);

  console.log(`\nGenerated ${newPosts.length} new posts.`);
  console.log(`Evergreen bank now has ${existing.posts.length} posts.`);
}

main().catch(err => {
  console.error(`generate-evergreen failed: ${err.message}`);
  process.exit(1);
});
