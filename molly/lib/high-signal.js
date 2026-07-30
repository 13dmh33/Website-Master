'use strict';

// high-signal — flags Molly posts with unusually high profile visits
// (>2x weekly average) for a Dave-notification handoff, mirroring
// milly/lib/reeve-handoff.js's pattern exactly (same repo, sibling system).
//
// Difference from Milly's version: Milly hands off to a separate product
// (Reeve) via a shared archive file since neither service is deployed for a
// live webhook. Molly's "Reeve" is just Dave himself — Trevo is his own
// business — so this writes to Molly's own archive dir and
// scripts/check-high-signal.js reads it directly in the same repo, no
// cross-system file needed.
//
// This is the buildable-today piece of the "Instagram DM catcher" scoped in
// molly/CLAUDE.md. The full spec (live webhook, automated welcome DM,
// Supabase dedup) needs a real @trevoadvisors Instagram Business account,
// Meta App review for messaging permissions, and a Supabase project — none
// of which exist yet (same blocker Reeve's own DM agent has). This flags a
// high-signal week so Dave can manually increase outreach in the meantime,
// same as Reeve's DM agent handoff does for Milly today.

const fs   = require('fs');
const path = require('path');
const store = require('./store');

function flagHighSignal(post, weekOf) {
  const filePath = path.join(store.paths.archive, `high-signal-${weekOf}.json`);

  let existing = [];
  if (fs.existsSync(filePath)) {
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { /* start fresh */ }
  }

  existing.push({
    postId:         post.id,
    detectedAt:     new Date().toISOString(),
    engagementRate: post.engagementRate,
    profileVisits:  post.profile_visits,
    permalink:      post.permalink,
    format:         post.format,
    weekOf,
    action:         'increase_manual_outreach',
  });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
  console.log(`High-signal post flagged: ${post.id} (${post.engagementRate}% engagement, ${post.profile_visits} profile visits)`);
}

module.exports = { flagHighSignal };
