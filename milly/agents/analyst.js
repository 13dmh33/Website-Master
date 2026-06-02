'use strict';

// analyst — Instagram performance feedback agent
// runs Sunday 10pm MT via GitHub Actions
// reads Instagram insights → updates brand-voice.json with what's working
// skips gracefully if INSTAGRAM_ACCESS_TOKEN is not set

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const insights = require('../lib/instagram-insights');
const store    = require('../lib/store');
const claude   = require('../lib/claude');

// get the Monday of the current week as YYYY-MM-DD
function weekStartDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

// identify which content format a post likely belongs to based on caption keywords
function guessFormat(caption) {
  if (!caption) return 'unknown';
  if (/swipe|slide/i.test(caption)) return 'carousel';
  if (/that's the job/i.test(caption)) return 'reevefound';
  if (/hook|sec|b-roll/i.test(caption)) return 'reel';
  return 'caption';
}

// identify which niche based on caption content
function guessNiche(caption) {
  if (!caption) return 'unknown';
  if (/pipeline|booking|conference|pitch|proposal/i.test(caption)) return 'booking';
  if (/system|process|track|automate|tool/i.test(caption)) return 'automation';
  return 'mindset';
}

// run pattern analysis with Claude after 4+ weeks of data
async function runPatternAnalysis(analyticsHistory) {
  const summary = analyticsHistory.map(week => ({
    weekOf:      week.weekOf,
    topFormat:   week.topPerformer?.format,
    topRate:     week.topPerformer?.engagementRate,
    avgRate:     week.avgEngagementRate,
  }));

  const prompt = `Here is ${analyticsHistory.length} weeks of Instagram performance data for Reeve, a speaker booking agency.

Data:
${JSON.stringify(summary, null, 2)}

Identify:
1. Which content formats drove the most profile visits
2. Which formats had the highest save rate
3. Best day/time combinations
4. Recommended adjustments to posting schedule and content mix

Return as JSON with this structure:
{
  "topFormats": ["format1", "format2"],
  "recommendations": ["plain English recommendation 1", "recommendation 2"],
  "scheduleAdjustments": "one sentence or null",
  "confidenceNote": "how reliable these findings are given sample size"
}`;

  try {
    const raw = await claude.call({ prompt, maxTokens: 800 });
    return claude.parseJson(raw);
  } catch (err) {
    console.warn(`Pattern analysis failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const weekOf = weekStartDate();

  if (!insights.isConfigured()) {
    console.log('Instagram insights not configured — skipping analytics this week.');
    console.log('To enable: add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID to .env');
    process.exit(0);
  }

  console.log(`Analytics running for week of ${weekOf}.`);

  let posts;
  try {
    posts = await insights.getWeeklyInsights(7);
  } catch (err) {
    console.error(`Failed to fetch Instagram insights: ${err.message}`);
    process.exit(1);
  }

  if (!posts || !posts.length) {
    console.log('No posts found in the past 7 days. Skipping analytics.');
    process.exit(0);
  }

  // enrich posts with guessed format + niche
  const enriched = posts.map(p => ({
    ...p,
    format: guessFormat(p.caption),
    niche:  guessNiche(p.caption),
  }));

  // find top performer by engagement rate
  const sorted       = [...enriched].sort((a, b) => b.engagementRate - a.engagementRate);
  const topPerformer = sorted[0];
  const avgRate      = parseFloat((enriched.reduce((s, p) => s + p.engagementRate, 0) / enriched.length).toFixed(2));

  // identify high-signal posts (profile visits > 2x weekly average)
  const avgProfileVisits = enriched.reduce((s, p) => s + p.profile_visits, 0) / enriched.length;
  const highSignalPosts  = enriched.filter(p => p.profile_visits > avgProfileVisits * 2);

  if (highSignalPosts.length) {
    console.log(`High-signal posts this week: ${highSignalPosts.length}`);
    // reeve-handoff.js will pick these up in Phase 2
    // TODO: call reeve-handoff.notifyReeve() here in Phase 2
  }

  // save analytics
  const analyticsData = {
    weekOf,
    generatedAt:       new Date().toISOString(),
    postsAnalyzed:     enriched.length,
    avgEngagementRate: avgRate,
    topPerformer:      {
      format:         topPerformer.format,
      niche:          topPerformer.niche,
      engagementRate: topPerformer.engagementRate,
      permalink:      topPerformer.permalink,
    },
    highSignalCount:   highSignalPosts.length,
    posts:             enriched,
  };

  const savedPath = store.saveAnalytics(analyticsData);

  // update brand voice with what's working
  const brandVoice = store.getBrandVoice();
  const whatWorks  = brandVoice.what_works || [];
  whatWorks.push({
    format:         topPerformer.format,
    niche:          topPerformer.niche,
    engagementRate: topPerformer.engagementRate,
    weekOf,
  });

  // identify top hashtags from high-performing posts
  const topHashtags = brandVoice.top_hashtags || [];
  for (const post of sorted.slice(0, 2)) {
    const hashtags = (post.caption || '').match(/#\w+/g) || [];
    topHashtags.push(...hashtags);
  }
  const uniqueTopHashtags = [...new Set(topHashtags)].slice(-20);

  store.updateBrandVoice({ what_works: whatWorks, top_hashtags: uniqueTopHashtags });

  console.log(`Analytics complete. Top performer: ${topPerformer.format} at ${topPerformer.engagementRate}% engagement. Brand voice updated.`);
  console.log(`Full analytics saved to: ${savedPath}`);

  // run pattern analysis if we have 4+ weeks of data
  const history = store.getRecentAnalytics(8);
  if (history.length >= 4) {
    console.log(`Running pattern analysis on ${history.length} weeks of data...`);
    const analysis = await runPatternAnalysis(history);
    if (analysis) {
      const fs   = require('fs');
      const path = require('path');
      const analysisPath = path.join(store.paths.archive, `pattern-analysis-${weekOf}.json`);
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
      console.log('\nPattern analysis recommendations:');
      (analysis.recommendations || []).forEach(r => console.log(`  • ${r}`));
    }
  }

  // TODO: Twilio weekly summary — add in Phase 2
}

main().catch(err => {
  console.error(`Analyst failed: ${err.message}`);
  process.exit(1);
});
