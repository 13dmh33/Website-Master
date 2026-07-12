const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const o = require('../owner-resolver');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'co-sos-rows.json'), 'utf8'));

test('isRegisteredAgentService flags commercial RA services, not people', () => {
  assert.ok(o.isRegisteredAgentService('Northwest Registered Agent Service Inc'));
  assert.ok(o.isRegisteredAgentService('LegalZoom.com Inc'));
  assert.ok(!o.isRegisteredAgentService('Michael J Torres'));
});

test('agentOwnerName returns a person, null for org/RA/blank', () => {
  assert.equal(o.agentOwnerName(rows[0]), 'Michael J Torres');
  assert.equal(o.agentOwnerName(rows[1]), 'Dana West');
  assert.equal(o.agentOwnerName(rows[2]), null); // agentorganizationname set → not a person
  assert.equal(o.agentOwnerName({ agentfirstname: 'John' }), null); // no last name
});

test('rowToProfile normalizes a CO row (no phone in dataset)', () => {
  const p = o.rowToProfile(rows[0]);
  assert.equal(p.name, 'RELIABLE PLUMBING SERVICES LLC');
  assert.equal(p.city, 'Aurora');
  assert.equal(p.phone, null);
  assert.equal(p.ownerName, 'Michael J Torres');
  assert.ok(p.mailing.includes('Aurora'));
});

test('resolveFromCoRows picks the name+city match and returns the owner', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Aurora, CO', phone: '+1 720-404-1160' };
  const r = o.resolveFromCoRows(rows, lead);
  assert.ok(r);
  assert.equal(r.owner_name, 'Michael J Torres'); // Aurora row, not the Grand Junction one
  assert.equal(r.source, 'co-sos');
  assert.ok(r.confidence >= 0.67 && r.confidence <= 0.9);
});

test('resolveFromCoRows requires city match (strict 2-of-2, no phone available)', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Boulder, CO', phone: '' };
  assert.equal(o.resolveFromCoRows(rows, lead), null); // name matches but no CO city row is Boulder
});

test('resolveFromCoRows returns null when accepted rows disagree on the owner (ambiguous)', () => {
  const ambiguous = [
    { entityname: 'Ace Handyman LLC', principalcity: 'Denver', principalstate: 'CO', entitystatus: 'Good Standing', agentfirstname: 'Sam', agentlastname: 'Green' },
    { entityname: 'Ace Handyman LLC', principalcity: 'Denver', principalstate: 'CO', entitystatus: 'Good Standing', agentfirstname: 'Pat', agentlastname: 'Blue' },
  ];
  const lead = { business_name: 'Ace Handyman', city: 'Denver, CO', phone: '' };
  assert.equal(o.resolveFromCoRows(ambiguous, lead), null);
});

test('resolveFromCoRows skips RA-service rows even when name+city match', () => {
  const lead = { business_name: 'Reliable Plumbing', city: 'Aurora, CO', phone: '' };
  // rows[2] (RELIABLE PLUMBING CO, Aurora) has an RA-service agent → not an owner.
  // rows[0] (Aurora, real person) should still win.
  const r = o.resolveFromCoRows(rows, lead);
  assert.ok(r);
  assert.equal(r.owner_name, 'Michael J Torres');
});

test('buildCoSosUrl encodes the business name as a $q full-text query', () => {
  const url = o.buildCoSosUrl({ business_name: 'Reliable Plumbing Services' }, 25);
  assert.ok(url.startsWith('https://data.colorado.gov/resource/4ykn-tg5h.json?'));
  assert.ok(url.includes('$q=Reliable%20Plumbing%20Services'));
  assert.ok(url.includes('$limit=25'));
});

test('nameOverlap is higher for closer names', () => {
  // Uses multi-token identities (trade words are stripped, so single-token names
  // like "Reliable Plumbing" collapse to {reliable} and can't be differentiated).
  assert.ok(o.nameOverlap('Rocky Mountain Handyman', 'Rocky Mountain Handyman Services') >
            o.nameOverlap('Rocky Mountain Handyman', 'Rocky Ford Plumbing'));
});
