'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMime, writeToZohoDrafts, sendViaZohoSmtp } = require('../lib/proposal/draft-mail');

test('buildMime — produces a well-formed MIME message with no network access', async () => {
  const mime = await buildMime({ from: 'dave@trevoadvisors.com', to: 'lead@example.com', subject: 'Your proposal', html: '<p>hello</p>' });
  const text = mime.toString();
  assert.ok(text.includes('From: dave@trevoadvisors.com'));
  assert.ok(text.includes('To: lead@example.com'));
  assert.ok(text.includes('Subject: Your proposal'));
});

test('writeToZohoDrafts — fails loud with no IMAP connection attempted when creds are missing', async () => {
  const mime = await buildMime({ from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>x</p>' });
  await assert.rejects(
    () => writeToZohoDrafts({ mime, zohoEmail: undefined, zohoAppPassword: undefined }),
    /ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set/
  );
});

test('sendViaZohoSmtp — fails loud with no send attempted when creds are missing', async () => {
  await assert.rejects(
    () => sendViaZohoSmtp({ from: 'a@b.com', to: 'c@d.com', subject: 's', html: '<p>x</p>', zohoEmail: '', zohoAppPassword: '' }),
    /ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set/
  );
});
