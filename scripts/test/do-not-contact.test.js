'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normEmail, normPhone, normDomain, isContactSuppressed, addContact, syncFromState,
} = require('../lib/do-not-contact');

test('normPhone — different formats of the same US number normalize equal', () => {
  assert.equal(normPhone('+1 702-480-9195'), '7024809195');
  assert.equal(normPhone('(702) 480-9195'), '7024809195');
  assert.equal(normPhone('7024809195'), '7024809195');
  assert.equal(normPhone('123'), null);
});

test('normEmail — trims and lowercases; rejects non-emails', () => {
  assert.equal(normEmail('  Dave@Example.COM '), 'dave@example.com');
  assert.equal(normEmail('not-an-email'), null);
  assert.equal(normEmail(''), null);
});

test('normDomain — strips protocol/www/path so the same site matches', () => {
  assert.equal(normDomain('https://www.acme-plumbing.com/contact'), 'acme-plumbing.com');
  assert.equal(normDomain('acme-plumbing.com'), 'acme-plumbing.com');
});

test('isContactSuppressed — matches on ANY identifier (the cross-campaign guarantee)', () => {
  const store = { entries: [
    { email: 'jo@acme.com', phone: '7024809195', domain: 'acme.com', reason: 'opted_out' },
  ]};
  // Re-scraped under a new lead_id but same phone → still suppressed.
  assert.equal(isContactSuppressed({ phone: '(702) 480-9195' }, store), true);
  // Same email, different everything → suppressed.
  assert.equal(isContactSuppressed({ email: 'JO@acme.com' }, store), true);
  // Same website domain only → suppressed.
  assert.equal(isContactSuppressed({ website: 'http://www.acme.com/about' }, store), true);
  // Totally different contact → not suppressed.
  assert.equal(isContactSuppressed({ email: 'someone@else.com', phone: '3035550000' }, store), false);
  // A contact with no usable identifier → never suppressed (can't match on nothing).
  assert.equal(isContactSuppressed({ email: '', phone: '' }, store), false);
});

test('addContact — is idempotent and merges missing identifiers on a shared key', () => {
  let store = { entries: [] };
  ({ store } = addContact({ phone: '702-480-9195', reason: 'opted_out', lead_id: 'a' }, store));
  assert.equal(store.entries.length, 1);
  // Same phone, now also brings an email → merges into the same entry, no duplicate.
  const r = addContact({ phone: '7024809195', email: 'jo@acme.com' }, store);
  assert.equal(r.added, false);
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].email, 'jo@acme.com');
});

test('addContact — a contact with nothing to key on is not stored', () => {
  const { store, added } = addContact({ email: '', phone: '', website: null }, { entries: [] });
  assert.equal(added, false);
  assert.equal(store.entries.length, 0);
});

test('syncFromState — backfills the store from unsubscribed leads via their briefs', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnc-'));
  const queueDir = path.join(dir, 'queue');
  fs.mkdirSync(queueDir);
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify({ queue: [
    { lead_id: 'lead-a', status: 'unsubscribed' },
    { lead_id: 'lead-b', status: 'checked' }, // not unsubscribed — ignored
  ]}));
  fs.writeFileSync(path.join(queueDir, 'lead-a-brief.json'),
    JSON.stringify({ email: 'a@acme.com', phone: '303-555-1212', website: 'acme.com', business_name: 'Acme' }));

  const store = { entries: [] };
  const res = syncFromState({ statePath, queueDir, store, persist: false });
  assert.equal(res.added, 1);
  assert.equal(res.scanned, 1);
  assert.equal(isContactSuppressed({ email: 'a@acme.com' }, store), true);
  assert.equal(isContactSuppressed({ phone: '3035551212' }, store), true);
});
