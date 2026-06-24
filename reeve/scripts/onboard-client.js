#!/usr/bin/env node
'use strict';

// onboard-client.js — interactive client setup wizard
//
// Run this after Dave signs a new Reeve client to create their profile.
// It reads from the DM qualifier conversation if available, pre-fills what it knows,
// and prompts for the rest.
//
// Usage:
//   node scripts/onboard-client.js
//   node scripts/onboard-client.js --from-dm <senderId>    (pre-fill from DM conversation)
//   node scripts/onboard-client.js --json <file>           (import from JSON file)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline  = require('readline');
const fs        = require('fs');
const path      = require('path');
const clientStore = require('../lib/client-store');
const state       = require('../lib/state');

const args      = process.argv.slice(2);
const hasFlag   = (f) => args.includes(f);
const getArg    = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

// ── Readline interface ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue = '') {
  return new Promise(resolve => {
    const prompt = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function askRequired(question, defaultValue = '') {
  return new Promise(async resolve => {
    let answer = '';
    while (!answer) {
      answer = (await ask(question, defaultValue)).trim();
      if (!answer) console.log('  This field is required.');
    }
    resolve(answer);
  });
}

// ── Pre-fill from DM conversation ────────────────────────────────────────────

function loadDmData(senderId) {
  const convo = state.getConversation(senderId);
  if (!convo) {
    console.log(`No DM conversation found for sender ID: ${senderId}`);
    return null;
  }
  if (!convo.routed) {
    console.log(`Conversation for ${senderId} hasn't been routed yet (stage: ${convo.stage}).`);
    return null;
  }

  console.log(`\nPre-filling from DM conversation with ${convo.senderName || senderId}`);
  console.log(`  Score:      ${convo.score}`);
  console.log(`  Paid gigs:  ${convo.answers.paid_talks_count || '—'}`);
  console.log(`  Fee range:  ${convo.answers.fee_range || '—'}`);
  console.log(`  Topic:      ${convo.answers.topic || '—'}`);
  console.log('');

  return {
    name:          convo.senderName || '',
    dmSenderId:    senderId,
    qualScore:     convo.score,
    topics:        convo.answers.topic ? [convo.answers.topic] : [],
    feeRaw:        convo.answers.fee_range || '',
  };
}

// Parse a rough fee string ("$4,000" or "$3k-$5k") into a {min, max} pair
function parseFee(raw) {
  if (!raw) return { min: null, max: null };
  const nums = raw.replace(/,/g, '').match(/[\d]+(?:k)?/gi) || [];
  const toNum = (s) => {
    const n = parseFloat(s.replace(/k$/i, ''));
    return s.toLowerCase().endsWith('k') ? n * 1000 : n;
  };
  const values = nums.map(toNum).filter(n => !isNaN(n));
  if (!values.length) return { min: null, max: null };
  if (values.length === 1) return { min: values[0], max: values[0] };
  return { min: Math.min(...values), max: Math.max(...values) };
}

// ── Main wizard ───────────────────────────────────────────────────────────────

async function runWizard() {
  let prefill = {};

  const fromDmId = getArg('--from-dm');
  if (fromDmId) {
    prefill = loadDmData(fromDmId) || {};
  }

  const jsonFile = getArg('--json');
  if (jsonFile) {
    try {
      prefill = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      console.log(`Loaded prefill from ${jsonFile}`);
    } catch (err) {
      console.error(`Failed to load ${jsonFile}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('\n══════════════════════════════════════');
  console.log('  Reeve — New Client Onboarding');
  console.log('══════════════════════════════════════');
  console.log('Press Enter to accept the default value shown in [brackets].\n');

  // ── Basic info ────────────────────────────────────────────────────────────
  const finalName      = await askRequired('Full name', prefill.name || '');
  const email          = await askRequired('Email address');
  const phone          = await ask('Phone number (optional)');
  const instagramHandle = await ask('Instagram handle (e.g. @janedoe)');

  // ── Speaking profile ──────────────────────────────────────────────────────
  console.log('\n── Speaking profile ──');
  const talkTitle = await askRequired('Primary talk title (e.g. "The Art of Confident Leadership")');
  const topicStr  = await ask('Topics / niche keywords (comma-separated)', (prefill.topics || []).join(', '));
  const topics    = topicStr.split(',').map(t => t.trim()).filter(Boolean);

  const durStr    = await ask('Available talk durations in minutes (comma-separated)', '20,45,60');
  const durations = durStr.split(',').map(d => parseInt(d.trim(), 10)).filter(n => !isNaN(n));

  const bio       = await ask('Short bio (1–2 sentences, or leave blank to add later)');

  // ── Fee ───────────────────────────────────────────────────────────────────
  console.log('\n── Fee ──');
  const defaultFeeStr = prefill.feeRaw || '';
  const feeStr  = await ask('Keynote fee (e.g. "$5,000" or "$3k-$7k")', defaultFeeStr);
  const fee     = parseFee(feeStr);

  // ── Retainer ──────────────────────────────────────────────────────────────
  console.log('\n── Retainer ──');
  const tierInput  = await ask('Retainer tier (starter = $597/mo | full = $997/mo)', 'starter');
  const retainerTier = tierInput.toLowerCase().includes('full') ? 'full' : 'starter';

  // ── Source ────────────────────────────────────────────────────────────────
  const leadSource = prefill.dmSenderId ? 'instagram_dm' : await ask('Lead source', 'referral');

  // ── Notes ─────────────────────────────────────────────────────────────────
  const notes = await ask('Any notes for Dave (optional)');

  rl.close();

  // ── Create client ─────────────────────────────────────────────────────────
  const client = clientStore.createClient({
    name:           finalName,
    email,
    phone:          phone || null,
    instagramHandle: instagramHandle || null,
    dmSenderId:     prefill.dmSenderId || null,
    talkTitle,
    talkDurations:  durations,
    bio:            bio || '',
    topics,
    fee,
    retainerTier,
    leadSource,
    qualScore:      prefill.qualScore || null,
    notes,
  });

  console.log('\n══════════════════════════════════════');
  console.log('  Client created successfully!');
  console.log('══════════════════════════════════════');
  console.log(`  ID:      ${client.id}`);
  console.log(`  Name:    ${client.name}`);
  console.log(`  Email:   ${client.email}`);
  console.log(`  Tier:    ${client.retainerTier} (${ retainerTier === 'full' ? '$997' : '$597'}/mo)`);
  console.log(`  Talk:    ${client.talkTitle}`);
  console.log(`  Topics:  ${client.topics.join(', ') || '—'}`);
  console.log(`  Fee:     $${client.fee.min || '?'} – $${client.fee.max || '?'}`);
  console.log(`  Saved:   output/clients/${client.id}.json`);
  console.log('══════════════════════════════════════');
  console.log('\nNext: run "node agents/conference-scout.js --summary" to see open opportunities.');
}

runWizard().catch(err => {
  console.error('Onboarding failed:', err.message);
  rl.close();
  process.exit(1);
});
