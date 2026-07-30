'use strict';

// analyst — Instagram performance feedback agent for Molly
// runs Sunday 10pm MT — reads Instagram insights, updates brand-voice.json
// skip gracefully if INSTAGRAM_ACCESS_TOKEN is not set

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const insights   = require('../lib/instagram-insights');
const store      = require('../lib/store');
const claude     = require('../lib/claude');
const abTracker  = require('../lib/ab-tracker');
const highSignal = require('../lib/high-signal');

function weekStartDate() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  return mon.toISOString().split('T')[0];
}

function guessFormat(caption) {
  if (!caption) return 'unknown';
  if (/swipe|slide/i.test(caption)) return 'carousel';
  if (/that's the build/i.test(caption)) return 'trevo_found';
  if (/hook|b-roll/i.test(caption)) return 'reel';
  return 'caption';
}

function guessNiche(caption) {
  if (!caption) return 'unknown';
  if (/calls|jobs|revenue|result|before/i.test(caption)) return 'results';
  if (/website|google|search|online|found/i.test(caption)) return 'education';
  if (/built|demo|feature|launch/i.test(caption)) return 'product';
  return 'journey';
}

async function runPatternAnalysis(analyticsHistory) {
  const summary = analyticsHistory.map(week => ({
    weekOf:    week.weekOf,
    topFormat: week.topPerformer?.format,
    topRate:   week.topPerformer?.engagementRate,
    avgRate:   week.avgEngagementRate,
  }));

  const prompt = `Here is ${analyticsHistory.length} weeks of Instagram performance data for Trevo Advisors, a website agency for home service contractors.

Data:
${JSON.stringify(summary, null, 2)}

Identify:
1. Which content formats drove the most profile visits
2. Which formats had the highest save rate
3. Best day/time combinations
4. Recommended adjustments to posting schedule and content mix

Return as JSON:
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

  console.log(`Molly analytics running for week of ${weekOf}.`);

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

  const enriched = posts.map(p => ({
    ...p,
    format: guessFormat(p.caption),
    niche:  guessNiche(p.caption),
  }));

  const sorted       = [...enriched].sort((a, b) => b.engagementRate - a.engagementRate);
  const topPerformer = sorted[0];
  const avgRate      = parseFloat((enriched.reduce((s, p) => s + p.engagementRate, 0) / enriched.length).toFixed(2));

  // identify high-signal posts (profile visits 2x above average)
  const avgProfileVisits = enriched.reduce((s, p) => s + p.profile_visits, 0) / enriched.length;
  const highSignalPosts  = enriched.filter(p => p.profile_visits > avgProfileVisits * 2);

  if (highSignalPosts.length) {
    console.log(`High-signal posts this week: ${highSignalPosts.length} (${highSignalPosts.map(p => p.format).join(', ')})`);
    for (const post of highSignalPosts) highSignal.flagHighSignal(post, weekOf);
  }

  // hashtag performance tracking
  const topThird = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  const hashtagCounts = {};
  for (const post of topThird) {
    const hashtags = (post.caption || '').match(/#\w+/g) || [];
    for (const tag of hashtags) hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
  }

  const brandVoice      = store.getBrandVoice();
  const prevTopHashtags = brandVoice.top_hashtags || [];
  const hashtagFrequency = {};
  for (const entry of prevTopHashtags) {
    if (typeof entry === 'object') hashtagFrequency[entry.tag] = (entry.count || 0) + (hashtagCounts[entry.tag] || 0);
    else hashtagFrequency[entry] = (hashtagFrequency[entry] || 0) + (hashtagCounts[entry] || 0);
  }
  for (const [tag, count] of Object.entries(hashtagCounts)) {
    hashtagFrequency[tag] = (hashtagFrequency[tag] || 0) + count;
  }
  const uniqueTopHashtags = Object.entries(hashtagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

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
    highSignalCount: highSignalPosts.length,
    posts:           enriched,
  };

  const savedPath  = store.saveAnalytics(analyticsData);
  const whatWorks  = brandVoice.what_works || [];
  whatWorks.push({
    format:         topPerformer.format,
    niche:          topPerformer.niche,
    engagementRate: topPerformer.engagementRate,
    weekOf,
  });

  store.updateBrandVoice({ what_works: whatWorks, top_hashtags: uniqueTopHashtags });

  console.log(`Analytics complete. Top: ${topPerformer.format} at ${topPerformer.engagementRate}% engagement.`);
  console.log(`Full analytics saved to: ${savedPath}`);

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
}

main().catch(err => {
  console.error(`Analyst failed: ${err.message}`);
  process.exit(1);
});
