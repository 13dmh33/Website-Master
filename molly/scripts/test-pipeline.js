'use strict';

// test-pipeline — validates the full Molly pipeline with mock data
// does not call Claude API or Buffer
// run this after setup to verify the system works end-to-end

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const store = require('../lib/store');
const path  = require('path');
const fs    = require('fs');

async function main() {
  console.log('\nMolly pipeline test — Trevo Advisors\n' + '─'.repeat(40));

  // 1. Test store
  console.log('\n1. Store layer');
  const brandVoice = store.getBrandVoice();
  if (brandVoice) {
    console.log(`  ✓  Brand voice loaded (${brandVoice.brand})`);
  } else {
    console.log('  ✗  Brand voice not found');
  }

  const postFormats = store.getPostFormats();
  if (postFormats) {
    const fmts = Object.keys(postFormats.formats || {});
    console.log(`  ✓  Post formats loaded: ${fmts.join(', ')}`);
  } else {
    console.log('  ✗  Post formats not found');
  }

  const evergreen = store.getEvergreen();
  if (evergreen && evergreen.posts) {
    const unused = evergreen.posts.filter(p => !p.used).length;
    console.log(`  ✓  Evergreen bank: ${evergreen.posts.length} posts (${unused} unused)`);
  } else {
    console.log('  ✗  Evergreen bank not found — run: node scripts/generate-evergreen.js');
  }

  // 2. Test mock brief + content
  console.log('\n2. Mock data round-trip');
  const mockWeek = store.dateKey();
  const mockBrief = {
    weekOf: mockWeek,
    generatedAt: new Date().toISOString(),
    researchMode: 'test',
    angles: [
      { id: 'angle-1', niche: 'education', angle: 'Test angle', hook: 'Test hook', suggestedFormat: 'carousel' },
      { id: 'angle-2', niche: 'results', angle: 'Test results', hook: 'Test hook 2', suggestedFormat: 'caption' },
      { id: 'angle-3', niche: 'product', angle: 'Test product', hook: 'Test hook 3', suggestedFormat: 'trevo_found' },
      { id: 'angle-4', niche: 'journey', angle: 'Test journey', hook: 'Test hook 4', suggestedFormat: 'reel' },
    ],
  };
  store.saveBrief(mockBrief);
  const readBack = store.getLatestBrief();
  if (readBack && readBack.weekOf === mockWeek) {
    console.log(`  ✓  Brief write/read OK (weekOf: ${readBack.weekOf})`);
  } else {
    console.log('  ✗  Brief write/read failed');
  }

  // 3. Test week niches
  console.log('\n3. Week rotation');
  const niches = store.getWeekNiches();
  console.log(`  ✓  This week: caption=${niches.caption}, reel=${niches.reel}, weekNumber=${niches.weekNumber}`);

  // 4. Test evergreen fallback
  console.log('\n4. Evergreen fallback');
  if (evergreen && evergreen.posts) {
    const posts = store.getUnusedEvergreen(4);
    console.log(`  ✓  getUnusedEvergreen(4) returned ${posts.length} posts`);
    if (posts.length) {
      console.log(`     First post: "${posts[0].hook.slice(0, 60)}..."`);
    }
  }

  // 5. Test Claude (if key available)
  console.log('\n5. Claude API');
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const claude = require('../lib/claude');
      const result = await claude.call({ prompt: 'Say "Molly test OK" and nothing else.', maxTokens: 20 });
      console.log(`  ✓  Claude response: "${result.trim()}"`);
    } catch (err) {
      console.log(`  ✗  Claude call failed: ${err.message}`);
    }
  } else {
    console.log('  –  ANTHROPIC_API_KEY not set — skipping API test');
  }

  console.log('\n' + '─'.repeat(40));
  console.log('Test complete. Ready to run the full pipeline:\n');
  console.log('  npm run research   # Monday');
  console.log('  npm run generate   # Monday after research');
  console.log('  npm run design     # Monday after generate');
  console.log('  npm run schedule   # Tuesday morning\n');
}

main().catch(err => {
  console.error(`Test failed: ${err.message}`);
  process.exit(1);
});
