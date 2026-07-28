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
- Caption for the post (60-100 words, ends with "Link in bio to see what yours could look like.")` : ''}
${format === 'caption' ? `- 100-150 word caption (results or education niche)
- Opens with a hook line
- Short paragraphs
- Ends with "— Trevo"` : ''}
${format === 'trevo_found' ? `- 80-120 words
- Opens with "Here's what's inside a Trevo [trade] site." — never name a city, and never imply a specific real client build
- Lists 4-6 specific features
- Ends with "That's the build. — Trevo\nLink in bio to see what yours could look like."` : ''}
${format === 'reel' ? `- 20-second reel script format, labelled in sentence case exactly: Hook (0-2s), Body (2-14s), Cta (14-20s) — never all-caps labels
- Include b-roll notes in brackets
- Under 60 spoken words
- Ends with "— Trevo"` : ''}

Tone: direct, results-focused, never salesy. Sentence case. No buzzwords.

Hard rules — a post breaking any of these is discarded by lib/brand-validator.js, so follow them exactly:
- Never state a price or any dollar figure. Pricing is a DM/site conversation, never a post.
- Never promise a delivery time (no "48 hours", "same-day", "next-day", "instant"). "In as little as two days" is the only allowed phrasing, used sparingly.
- Never name a city, region, or real business. Targeting is national and trade-agnostic.
- Never name the founder. Sign off as "— Trevo" only.
- Never describe a specific client's results — no consenting client exists yet.
- Any quantified claim (reviews, jobs, calls, customers, percentages, minutes) needs a named source and year from: BrightLocal, Think with Google, Pew Research, SBA, BBB, U.S. Census, BLS, ServiceTitan, Housecall Pro, Jobber. If you cannot cite one, make the point qualitatively instead.
- Say "AI agent", never "bot". Never imply AI replaces staff.
- No emojis. No "business day(s)" language. Exactly one call to action.

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
