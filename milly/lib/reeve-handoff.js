'use strict';

// reeve handoff
// called by analyst when a post shows unusually high profile visits (>2x weekly average)
// these are high-signal weeks where Dave should increase manual outreach activity
//
// Wired to Reeve via the shared archive file (Milly and Reeve are sibling
// directories in the same monorepo) — reeve/scripts/check-high-signal.js reads
// this file and emails Dave. Run in the same CI job as analyst.js (see
// .github/workflows/milly-weekly-analytics.yml) since neither service is
// deployed yet for a live webhook between them.

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
}

module.exports = { notifyReeve };
