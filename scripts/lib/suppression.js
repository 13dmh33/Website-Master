// Single global do-not-contact check, used as a hard gate by every send path
// (Pitcher, drip.js). state.json's per-lead `status` is the canonical source —
// every unsubscribe path (webhook.js STOP keywords, poller.js/reply-agent.js
// reply classification) already writes 'unsubscribed' there.

const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '..', '..', 'state.json');

function isSuppressed(leadId) {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const entry = state.queue.find(l => l.lead_id === leadId);
  return entry ? entry.status === 'unsubscribed' : false;
}

module.exports = { isSuppressed };
