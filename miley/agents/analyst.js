'use strict';

// analyst — Instagram performance feedback agent
// runs Sunday 10pm MT via GitHub Actions
// reads Instagram insights → updates brand-voice.json with what's working
// skips gracefully if INSTAGRAM_ACCESS_TOKEN is not set

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const insights      = require('../lib/instagram-insights');
const store         = require('../lib/store');
const claude        = require('../lib/claude');
const sentiment     = require('../lib/sentiment');

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
  if (/\[hook|on-screen|voiceover/i.test(caption)) return 'reel';
  return 'single_image';
}

// identify which content type based on caption content (Techs4Tatas pillars)
function guessNiche(caption) {
  if (!caption) return 'unknown';
  if (/link in bio|shop|grab yours|tee|hat|sticker|snapback/i.test(caption)) return 'product_feature';
  if (/comment|tag a|drop your|finish the sentence|vote/i.test(caption)) return 'engagement';
  if (/30%|breast cancer|fund the fight|wear it, fund/i.test(caption)) return 'mission';
  if (/earned|she didn't|strong|the next girl|hard days/i.test(caption)) return 'motivational';
  return 'trades_humor';
}

// self-critique loop (#2): tag and store the actual top posts per content type
// (capped at 5, decayed to the last 90 days) so the Generator can read real
// past performance back in as few-shot examples instead of starting fresh.
function updateTopPerformers(enriched, weekOf) {
  const data = store.getTopPerformers();
  const byType = data.byType || {};
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const byNiche = {};
  for (const post of enriched) {
    if (!post.caption) continue;
    (byNiche[post.niche] = byNiche[post.niche] || []).push(post);
  }

  for (const [niche, posts] of Object.entries(byNiche)) {
    const existing = (byType[niche] || []).filter(p => new Date(p.recordedAt || p.weekOf).getTime() >= cutoff);
    const fresh = posts.map(p => ({
      caption:        p.caption,
      engagementRate: p.engagementRate,
      weekOf,
      recordedAt:     new Date().toISOString(),
    }));
    byType[niche] = [...existing, ...fresh]
      .sort((a, b) => b.engagementRate - a.engagementRate)
      .slice(0, 5);
  }

  store.saveTopPerformers({ updatedAt: new Date().toISOString(), byType });
}

// click attribution — joins exported UTM click data (output/clicks/latest.json)
// to this week's posts by utm_content (product). Free GA4/Pixel/ManyChat export.
// Returns a summary or null if no click data is present.
function reportClicks() {
  const clicks = store.getClickData();
  if (!clicks) return null;

  const byContent = clicks.by_content || {};
  const ranked = Object.entries(byContent).sort((a, b) => b[1] - a[1]);

  console.log('\nLink attribution (from exported UTM data):');
  if (clicks.linkpage_views != null) console.log(`  Linkpage views: ${clicks.linkpage_views}`);
  if (ranked.length) {
    console.log('  Top products by clicks:');
    ranked.slice(0, 5).forEach(([key, n]) => console.log(`    • ${key}: ${n}`));
  } else {
    console.log('  (no per-product clicks in the export yet)');
  }
  return {
    weekOf:         clicks.weekOf || null,
    linkpageViews:  clicks.linkpage_views || 0,
    topProducts:    ranked.slice(0, 5).map(([key, clicks]) => ({ key, clicks })),
    totalClicks:    ranked.reduce((s, [, n]) => s + n, 0),
  };
}

// sentiment mining (#8): classify exported comments/DMs and feed aggregated
// sentiment back into brand-voice.json, alongside (not replacing) the
// click-based sales signal — so tone evolution isn't purely revenue-driven.
// No-ops gracefully if no export exists or no API key is set.
async function runSentimentMining() {
  const data = store.getComments();
  if (!data || !data.comments || !data.comments.length) return null;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`\nFound ${data.comments.length} exported comments but no ANTHROPIC_API_KEY — skipping sentiment classification.`);
    return null;
  }

  console.log(`\nClassifying ${data.comments.length} exported comments/DMs...`);
  try {
    const classified = await sentiment.classifyComments(data.comments);
    const summary = sentiment.summarize(classified);
    console.log(`  Sentiment: ${summary.bySentiment.positive} positive / ${summary.bySentiment.neutral} neutral / ${summary.bySentiment.negative} negative`);
    return { weekOf: data.weekOf || null, ...summary };
  } catch (err) {
    console.warn(`Sentiment classification failed: ${err.message}`);
    return null;
  }
}

// run pattern analysis with Claude after 4+ weeks of data
async function runPatternAnalysis(analyticsHistory) {
  const summary = analyticsHistory.map(week => ({
    weekOf:      week.weekOf,
    topFormat:   week.topPerformer?.format,
    topRate:     week.topPerformer?.engagementRate,
    avgRate:     week.avgEngagementRate,
  }));

  const prompt = `Here is ${analyticsHistory.length} weeks of Instagram performance data for Techs4Tatas, an apparel brand celebrating women in the skilled trades (30% of profit funds breast cancer research).

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

  // click attribution runs regardless of whether IG insights are configured —
  // it's the sales signal (which products people actually click through to buy).
  const clickSummary = reportClicks();

  // sentiment mining (#8) also runs regardless of IG token — manual export path.
  const sentimentSummary = await runSentimentMining();
  if (sentimentSummary) {
    store.updateBrandVoice({ sentiment_signal: sentimentSummary });
  }

  if (!insights.isConfigured()) {
    if (clickSummary || sentimentSummary) {
      store.saveAnalytics({ weekOf, generatedAt: new Date().toISOString(), clicks: clickSummary, sentiment: sentimentSummary });
      console.log('\nInstagram insights not configured — saved click/sentiment signals only.');
    } else {
      console.log('Instagram insights not configured and no click/comment data — nothing to analyze this week.');
    }
    console.log('To enable engagement analytics: add INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID to .env');
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

  updateTopPerformers(enriched, weekOf);

  // find top performer by engagement rate
  const sorted       = [...enriched].sort((a, b) => b.engagementRate - a.engagementRate);
  const topPerformer = sorted[0];
  const avgRate      = parseFloat((enriched.reduce((s, p) => s + p.engagementRate, 0) / enriched.length).toFixed(2));

  // identify high-signal posts (profile visits > 2x weekly average)
  const avgProfileVisits = enriched.reduce((s, p) => s + p.profile_visits, 0) / enriched.length;
  const highSignalPosts  = enriched.filter(p => p.profile_visits > avgProfileVisits * 2);

  if (highSignalPosts.length) {
    console.log(`High-signal posts this week (profile visits > 2x avg): ${highSignalPosts.length}`);
    for (const post of highSignalPosts) {
      console.log(`  • ${post.permalink || post.id} — ${post.profile_visits} profile visits`);
    }
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
    clicks:            clickSummary || null,
    sentiment:         sentimentSummary || null,
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

  // Enhancement A: hashtag performance tracking
  // count how many times each hashtag appeared in top-performing posts (top 33%)
  const topThird       = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
  const hashtagCounts  = {};
  for (const post of topThird) {
    const hashtags = (post.caption || '').match(/#\w+/g) || [];
    for (const tag of hashtags) {
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    }
  }
  // keep rolling top-hashtag list: tags that appeared 3+ times across all weeks get priority
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
