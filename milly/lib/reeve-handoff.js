'use strict';

// reeve handoff stub
// called by analyst when a post shows unusually high profile visits (>2x weekly average)
// these are high-signal weeks where Reeve's DM agent should increase outreach activity
//
// TODO (Phase 2): wire this to Reeve's Watcher agent
// when notifyReeve is called, Reeve should increase DM volume for the following 3 days
// integration point: Reeve reads /output/archive/high-signal-[date].json or receives webhook

const fs   = require('fs');
const path = require('path');
const store = require('./store');

// flag a post as high-signal and write to archive for Reeve to pick up
// postId: Instagram media ID
// metrics: { engagementRate, profile_visits, permalink, weekOf }
function notifyReeve(postId, metrics) {
  const weekOf   = metrics.weekOf || store.dateKey();
  const filePath = path.join(store.paths.archive, `high-signal-${weekOf}.json`);

  let existing = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }

  existing.push({
    postId,
    detectedAt:     new Date().toISOString(),
    engagementRate: metrics.engagementRate,
    profileVisits:  metrics.profile_visits,
    permalink:      metrics.permalink,
    weekOf,
    action:         'increase_dm_volume', // instruction for Reeve
  });

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  console.log(`High-signal post flagged for Reeve: ${postId} (${metrics.engagementRate}% engagement)`);

  // TODO: send webhook to Reeve's Watcher agent here in Phase 2
  // example: POST https://reeve.agency/api/signal { postId, metrics }
}

module.exports = { notifyReeve };
