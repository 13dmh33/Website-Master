'use strict';

// dm-responder.js — drive the DM autoresponder.
//
//   node scripts/dm-responder.js --simulate "PINK"      → show the reply for a message
//   node scripts/dm-responder.js --capture "me@x.com"   → record an email lead
//   node scripts/dm-responder.js --export-manychat      → write config/manychat-flow.json
//   node scripts/dm-responder.js                        → usage + sample replies
//
// LIVE automation: Instagram DM auto-reply needs either ManyChat (free tier —
// import the exported flow) or the Meta Graph API messaging webhook. The webhook
// must be publicly reachable, so run it on the Mac (like the Trevo/Reeve webhooks),
// not the container. This script provides the on-brand reply logic + a no-code
// export so nothing here ever spends or sends from the container.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs    = require('fs');
const path  = require('path');
const store = require('../lib/store');
const dm    = require('../lib/dm-autoresponder');

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] || '');
}

function printReply(message) {
  const intent = dm.detectIntent(message);
  console.log(`\nInbound: "${message}"`);
  console.log(`Intent:  matched=${intent.matched} kind=${intent.kind}${intent.keyword ? ` keyword=${intent.keyword}` : ''}`);
  if (!intent.matched) {
    console.log('Reply:   (no auto-reply — hand to a human)');
    return;
  }
  const reply = dm.buildReply({ kind: intent.kind });
  reply.messages.forEach((m, i) => console.log(`Reply ${i + 1}: ${m}`));

  // if the message itself contains an email, capture it
  const email = dm.extractEmail(message);
  if (email) {
    const added = store.saveLead({ email, source: 'dm' });
    console.log(`Lead:    ${email} → ${added ? 'saved' : 'already on list'}`);
  }
}

function main() {
  if (flag('--simulate') !== null) {
    printReply(flag('--simulate') || dm.KEYWORD);
    return;
  }

  const email = flag('--capture');
  if (email) {
    const found = dm.extractEmail(email);
    if (!found) { console.error(`Not a valid email: "${email}"`); process.exit(1); }
    const added = store.saveLead({ email: found, source: 'dm' });
    const total = store.getLeads().leads.length;
    console.log(`${added ? 'Saved' : 'Already had'} ${found}. List size: ${total}.`);
    return;
  }

  if (args.includes('--export-manychat')) {
    const flow = dm.manychatFlow();
    store.ensureDir(path.join(store.paths.linkpage, '..', 'config'));
    const out = path.join(__dirname, '..', 'config', 'manychat-flow.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(flow, null, 2), 'utf8');
    console.log(`ManyChat flow written → ${out}`);
    return;
  }

  // default: usage + samples
  console.log('DM autoresponder — usage:');
  console.log('  --simulate "<message>"   show the reply for an inbound DM');
  console.log('  --capture  "<email>"     record an email lead');
  console.log('  --export-manychat        write config/manychat-flow.json (no-code path)');
  console.log(`\nKeyword: ${dm.KEYWORD}\n\nSample replies:`);
  ['PINK', 'whats the link?', 'what size should I get?', 'love this account'].forEach(printReply);
}

main();
