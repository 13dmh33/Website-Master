const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const se = require('../lib/social-extractor');

const leadSite = fs.readFileSync(path.join(__dirname, 'fixtures', 'lead-site.html'), 'utf8');
const bbb = fs.readFileSync(path.join(__dirname, 'fixtures', 'bbb-profile.html'), 'utf8');

test('extractContact pulls email, phone, name, socials from a lead site', () => {
  const c = se.extractContact(leadSite, { host: 'acmehandyman.com' });
  assert.equal(c.email, 'mike@acmehandyman.com');   // on-domain email preferred
  assert.equal(c.phone, '+1 303-555-0182');
  assert.equal(c.contact_name, 'Mike Ramirez');
  assert.ok(c.socials);
  assert.equal(c.socials.facebook, 'https://facebook.com/acmehandymandenver');
  assert.equal(c.socials.instagram, 'https://www.instagram.com/acme.handyman');
  assert.equal(c.socials.youtube, 'https://www.youtube.com/@acmehandyman');
});

test('extractContact reads JSON-LD sameAs socials + telephone/email on a BBB profile', () => {
  const c = se.extractContact(bbb);
  assert.equal(c.phone, '+1 720-404-1160');
  assert.equal(c.email, 'office@reliableplumbingco.com');
  assert.ok(c.socials.facebook.includes('reliableplumbingaurora'));
  assert.ok(c.socials.instagram.includes('reliableplumbingco'));
  assert.ok(c.socials.linkedin.includes('reliable-plumbing-services'));
});

test('formatSocials renders the CRM cell format', () => {
  const s = se.formatSocials({ facebook: 'https://fb.com/x', instagram: 'https://ig.com/y' });
  assert.equal(s, 'facebook: https://fb.com/x | instagram: https://ig.com/y');
  assert.equal(se.formatSocials(null), '');
  assert.equal(se.formatSocials({}), '');
});

test('mergeSocials keeps the first non-empty value per network', () => {
  const merged = se.mergeSocials({ facebook: 'a' }, { facebook: 'b', instagram: 'c' });
  assert.equal(merged.facebook, 'a');
  assert.equal(merged.instagram, 'c');
});

test('re-exported primitives are the same implementation as contact-scraper', () => {
  const cs = require('../contact-scraper');
  assert.equal(se.normalizePhone, cs.normalizePhone);
  assert.equal(se.pickBest, cs.pickBest);
  assert.equal(se.extractAllFromPage, cs.extractAllFromPage);
});
