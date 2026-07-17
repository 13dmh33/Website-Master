#!/usr/bin/env node
/**
 * Unit tests for reply-agent pure helpers (no network, no API).
 * Run: node scripts/reply-agent.test.js
 */
'use strict';

const assert = require('assert');
const { stripQuotedAndSignature, buildDraftMime, foldMessageId, htmlToText, encodeHeaderWord,
        buildCampaignExit, lastCampaignStep } = require('./reply-agent');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('\nreply-agent helpers');
console.log('─'.repeat(56));

// ── stripQuotedAndSignature ──────────────────────────────────────────────────

test('keeps the actual reply, drops Gmail quoted history', () => {
  const raw = [
    'Yeah this sounds interesting, what would it cost?',
    '',
    'On Mon, Jul 14, 2026 at 9:00 AM Dave <dave@trevoadvisors.com> wrote:',
    '> Hey, I put together a quick demo of your site...',
    '> Let me know.'
  ].join('\n');
  assert.strictEqual(stripQuotedAndSignature(raw), 'Yeah this sounds interesting, what would it cost?');
});

test('drops Outlook "Original Message" block', () => {
  const raw = 'Not right now, try me in the fall.\n\n-----Original Message-----\nFrom: Dave\nSent: ...';
  assert.strictEqual(stripQuotedAndSignature(raw), 'Not right now, try me in the fall.');
});

test('drops standard "-- " signature delimiter', () => {
  const raw = 'Sounds good, call me.\n\n-- \nJoe Smith\nJoe\'s Plumbing\n555-1234';
  assert.strictEqual(stripQuotedAndSignature(raw), 'Sounds good, call me.');
});

test('drops "Sent from my iPhone" mobile signature', () => {
  const raw = 'How much per month?\n\nSent from my iPhone';
  assert.strictEqual(stripQuotedAndSignature(raw), 'How much per month?');
});

test('empty / null input is safe', () => {
  assert.strictEqual(stripQuotedAndSignature(''), '');
  assert.strictEqual(stripQuotedAndSignature(null), '');
});

// ── htmlToText (fallback for HTML-only replies) ──────────────────────────────

test('extracts text from an HTML-only reply body', () => {
  const html = '<div>Hey Dave,</div><p>How much per month?</p><br><p>Thanks</p>';
  assert.strictEqual(htmlToText(html), 'Hey Dave,\nHow much per month?\n\nThanks');
});

test('strips style/script and decodes entities', () => {
  const html = '<style>p{color:red}</style><p>Costs &lt;$200 &amp; no fee?</p>';
  assert.strictEqual(htmlToText(html), 'Costs <$200 & no fee?');
});

test('html fallback feeds the quote stripper cleanly', () => {
  const html = '<p>Sounds good, call me.</p><br>-- <br>Joe';
  // htmlToText → "Sounds good, call me.\n\n-- \nJoe"; stripper cuts at "-- "
  assert.strictEqual(stripQuotedAndSignature(htmlToText(html)), 'Sounds good, call me.');
});

// ── encodeHeaderWord (RFC 2047) ──────────────────────────────────────────────

test('leaves ASCII subjects untouched', () => {
  assert.strictEqual(encodeHeaderWord('Re: your website'), 'Re: your website');
});

test('base64-encodes a non-ASCII subject', () => {
  assert.strictEqual(encodeHeaderWord('Re: café ☕'),
    `=?UTF-8?B?${Buffer.from('Re: café ☕', 'utf8').toString('base64')}?=`);
});

test('non-ASCII subject flows through buildDraftMime encoded', () => {
  const mime = buildDraftMime({
    fromEmail: 'd@x.com', toEmail: 'a@b.com', subject: 'café',
    inReplyTo: null, references: [], bodyText: 'hi'
  });
  assert.ok(mime.includes('Subject: =?UTF-8?B?'), 'subject header is RFC-2047 encoded');
  assert.ok(!/Subject: café/.test(mime), 'raw non-ASCII is not emitted');
});

// ── foldMessageId ────────────────────────────────────────────────────────────

test('wraps a bare message-id in angle brackets', () => {
  assert.strictEqual(foldMessageId('abc@host'), '<abc@host>');
  assert.strictEqual(foldMessageId('<abc@host>'), '<abc@host>');
  assert.strictEqual(foldMessageId(null), null);
});

// ── buildDraftMime ───────────────────────────────────────────────────────────

test('builds a threaded, Re:-prefixed plain-text draft', () => {
  const mime = buildDraftMime({
    fromEmail: 'dave@trevoadvisors.com',
    toEmail:   'joe@joesplumbing.com',
    subject:   "Joe's Plumbing website",
    inReplyTo: '<orig-123@zoho.com>',
    references: [],
    bodyText:  'Happy to help.\n\nDave'
  });
  assert.ok(mime.includes('To: joe@joesplumbing.com'));
  assert.ok(mime.includes("Subject: Re: Joe's Plumbing website"), 'adds Re: prefix');
  assert.ok(mime.includes('In-Reply-To: <orig-123@zoho.com>'), 'threads via In-Reply-To');
  assert.ok(mime.includes('References: <orig-123@zoho.com>'), 'seeds References from In-Reply-To');
  assert.ok(mime.includes('Content-Type: text/plain; charset=utf-8'));
  assert.ok(mime.includes('\r\n\r\nHappy to help.'), 'CRLF header/body separation + body present');
});

test('does not double-prefix an existing Re: subject', () => {
  const mime = buildDraftMime({
    fromEmail: 'd@x.com', toEmail: 'a@b.com', subject: 'Re: your site',
    inReplyTo: null, references: [], bodyText: 'hi'
  });
  assert.ok(mime.includes('Subject: Re: your site'));
  assert.ok(!mime.includes('Re: Re:'));
});

test('merges existing References and appends In-Reply-To without duplicating', () => {
  const mime = buildDraftMime({
    fromEmail: 'd@x.com', toEmail: 'a@b.com', subject: 's',
    inReplyTo: '<m2@z>', references: ['<m1@z>', '<m2@z>'], bodyText: 'hi'
  });
  const refLine = mime.split('\r\n').find(l => l.startsWith('References:'));
  assert.strictEqual(refLine, 'References: <m1@z> <m2@z>', 'no duplicate m2');
});

// ── campaign exit ────────────────────────────────────────────────────────────

test('lastCampaignStep: initial send only → "initial"', () => {
  assert.strictEqual(lastCampaignStep({ email_sent_at: '2026-07-01T00:00:00Z' }), 'initial');
  assert.strictEqual(lastCampaignStep({}), 'initial');
  assert.strictEqual(lastCampaignStep(null), 'initial');
});

test('lastCampaignStep: returns the furthest drip step sent', () => {
  assert.strictEqual(lastCampaignStep({ drip: { d1: { email_sent_at: 'x' } } }), 'd1');
  assert.strictEqual(lastCampaignStep({ drip: { d1: { email_sent_at: 'x' }, d1b: { sms_sent_at: 'y' } } }), 'd1b');
  assert.strictEqual(lastCampaignStep({ drip: { d1: {}, d1c: { email_sent_at: 'x' }, d2: { email_sent_at: 'z' } } }), 'd2');
});

test('buildCampaignExit: fresh replied exit', () => {
  const c = buildCampaignExit('replied', { drip: { d1: { email_sent_at: 'x' } } });
  assert.strictEqual(c.status, 'exited');
  assert.strictEqual(c.reason, 'replied');
  assert.strictEqual(c.exit_step, 'd1');
  assert.strictEqual(c.exit_channel, 'email');
  assert.strictEqual(c.by, 'reply-agent');
  assert.ok(/^\d{4}-\d\d-\d\dT/.test(c.exited_at), 'exited_at is an ISO timestamp');
});

test('buildCampaignExit: idempotent — re-exit preserves first timestamp + step', () => {
  const prior = { campaign: { status: 'exited', reason: 'replied', exit_step: 'd1b', exit_channel: 'email', exited_at: '2026-07-10T00:00:00.000Z', by: 'reply-agent' } };
  const c = buildCampaignExit('replied', prior);
  assert.strictEqual(c.exited_at, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(c.exit_step, 'd1b');
  assert.strictEqual(c.reason, 'replied');
});

test('buildCampaignExit: opt-out upgrades a prior replied exit (opt-out wins)', () => {
  const prior = { campaign: { status: 'exited', reason: 'replied', exit_step: 'd1', exit_channel: 'email', exited_at: '2026-07-10T00:00:00.000Z', by: 'reply-agent' } };
  const c = buildCampaignExit('opted_out', prior);
  assert.strictEqual(c.reason, 'opted_out', 'reason upgraded to opted_out');
  assert.strictEqual(c.exited_at, '2026-07-10T00:00:00.000Z', 'original timestamp kept');
});

test('buildCampaignExit: replied never downgrades a prior opt-out', () => {
  const prior = { campaign: { status: 'exited', reason: 'opted_out', exit_step: 'initial', exit_channel: 'email', exited_at: '2026-07-10T00:00:00.000Z', by: 'reply-agent' } };
  const c = buildCampaignExit('replied', prior);
  assert.strictEqual(c.reason, 'opted_out', 'opt-out stays');
});

console.log('─'.repeat(56));
console.log(`${passed} passing${process.exitCode ? ' (with failures)' : ''}\n`);
