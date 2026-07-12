const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const d = require('../directory-scraper');

const bbbProfile = fs.readFileSync(path.join(__dirname, 'fixtures', 'bbb-profile.html'), 'utf8');

// ── name matching (order-independent, trade/suffix words ignored) ──────────────
test('nameTokens strips stopwords, suffixes and trade words', () => {
  assert.deepEqual([...d.nameTokens('Reliable Plumbing Services, LLC')], ['reliable']);
  assert.deepEqual([...d.nameTokens('Acme Handyman Co.')], ['acme']);
  assert.deepEqual([...d.nameTokens('Plumbing Services')], []); // all generic → no identity
});

test('nameMatch accepts real variants and rejects different businesses', () => {
  assert.ok(d.nameMatch('Reliable Plumbing Services', 'Reliable Plumbing Co'));
  assert.ok(d.nameMatch('Acme Handyman', 'ACME Handyman LLC'));
  assert.ok(!d.nameMatch('Reliable Plumbing', 'Denver Drain Kings'));
  assert.ok(!d.nameMatch('Plumbing Services', 'Heating Services')); // no identity tokens either side
});

// ── city / phone matching ─────────────────────────────────────────────────────
test('cityState parses "City, ST" and objects', () => {
  assert.deepEqual(d.cityState('Aurora, CO'), { city: 'aurora', state: 'co' });
  assert.deepEqual(d.cityState('Denver CO'), { city: 'denver', state: 'co' });
  assert.deepEqual(d.cityState({ city: 'Aurora', state: 'CO' }), { city: 'aurora', state: 'co' });
});

test('cityMatch requires same city and agreeing state', () => {
  assert.ok(d.cityMatch('Aurora, CO', 'Aurora', 'CO'));
  assert.ok(d.cityMatch('Aurora, CO', 'Aurora', null)); // unknown state on one side is OK
  assert.ok(!d.cityMatch('Aurora, CO', 'Aurora', 'TX'));
  assert.ok(!d.cityMatch('Aurora, CO', 'Denver', 'CO'));
});

test('phoneMatch normalizes both sides', () => {
  assert.ok(d.phoneMatch('+1 720-404-1160', '(720) 404-1160'));
  assert.ok(d.phoneMatch('7204041160', '1-720-404-1160'));
  assert.ok(!d.phoneMatch('+1 720-404-1160', '+1 303-555-0182'));
});

// ── the hard part: match scoring (2-of-3 gate) ────────────────────────────────
test('scoreMatch accepts a 3/3 profile and reports confidence', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Aurora, CO', phone: '+1 720-404-1160' };
  const profile = d.parseBbbProfile(bbbProfile, 'https://www.bbb.org/us/co/aurora/profile/plumber/reliable');
  const m = d.scoreMatch(lead, profile, 2);
  assert.equal(m.score, 3);
  assert.equal(m.confidence, 1);
  assert.ok(m.accepted);
  assert.deepEqual(m.matched, { name: true, city: true, phone: true });
});

test('scoreMatch rejects wrong-business contamination below threshold', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Aurora, CO', phone: '+1 720-404-1160' };
  const wrong = { name: 'Denver Drain Kings', city: 'Denver', state: 'CO', phone: '+1 303-111-2222' };
  const m = d.scoreMatch(lead, wrong, 2);
  assert.equal(m.score, 0);
  assert.ok(!m.accepted);
});

test('scoreMatch accepts 2/3 (name+city) when phone is absent', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Aurora, CO', phone: '' };
  const profile = { name: 'Reliable Plumbing Co', city: 'Aurora', state: 'CO', phone: null };
  const m = d.scoreMatch(lead, profile, 2);
  assert.equal(m.score, 2);
  assert.ok(m.accepted);
});

test('--min-confidence 3 rejects a 2/3 match', () => {
  const lead = { business_name: 'Reliable Plumbing Services', city: 'Aurora, CO', phone: '' };
  const profile = { name: 'Reliable Plumbing Co', city: 'Aurora', state: 'CO', phone: null };
  assert.ok(!d.scoreMatch(lead, profile, 3).accepted);
});

// ── BBB parsers ───────────────────────────────────────────────────────────────
test('parseBbbProfile pulls identity + contact + socials from the business JSON-LD only', () => {
  const p = d.parseBbbProfile(bbbProfile, 'https://www.bbb.org/x');
  assert.equal(p.name, 'Reliable Plumbing Services');
  assert.equal(p.phone, '+1 720-404-1160');
  assert.equal(p.email, 'office@reliableplumbingco.com');
  assert.equal(p.website, 'https://www.reliableplumbingco.com');
  assert.equal(p.city, 'Aurora');
  assert.equal(p.state, 'CO');
  // socials come from the business's JSON-LD sameAs (facebook/instagram/linkedin)
  assert.ok(p.socials.facebook.includes('reliableplumbingaurora'));
  assert.ok(p.socials.instagram.includes('reliableplumbingco'));
  assert.ok(p.socials.linkedin.includes('reliable-plumbing-services'));
  // the twitter link exists only as a page-wide <a href> — it must NOT be captured now
  assert.equal(p.socials.twitter, undefined);
});

test('parseBbbProfile does NOT leak the directory\'s own socials/email (contamination fix)', () => {
  // Realistic BBB page: business JSON-LD sameAs (facebook only) + BBB's OWN footer
  // socials for twitter/instagram/youtube/linkedin + a "report this business" mailto.
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Plumber","name":"Reliable Plumbing Services",
     "telephone":"(720) 404-1160","address":{"addressLocality":"Aurora","addressRegion":"CO"},
     "sameAs":["https://www.facebook.com/reliableplumbingaurora"]}
    </script>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization","name":"Better Business Bureau",
     "sameAs":["https://twitter.com/BBB_institute","https://www.instagram.com/betterbusinessbureau"]}
    </script></head>
    <body><footer>
      <a href="https://www.facebook.com/BBBNorthwest">BBB FB</a>
      <a href="https://twitter.com/BBB_institute">BBB X</a>
      <a href="https://www.youtube.com/user/CouncilBBB">BBB YT</a>
      <a href="https://www.linkedin.com/company/better-business-bureau">BBB LI</a>
      <a href="mailto:complaints@bbb.org">Report this business</a>
    </footer></body></html>`;
  const p = d.parseBbbProfile(html, 'https://www.bbb.org/x', 'Reliable Plumbing Services');
  assert.equal(p.email, null);                                  // NOT complaints@bbb.org
  assert.equal(p.socials.facebook, 'https://www.facebook.com/reliableplumbingaurora'); // business's own
  assert.equal(p.socials.twitter, undefined);                   // BBB's — dropped
  assert.equal(p.socials.instagram, undefined);                 // BBB's — dropped
  assert.equal(p.socials.youtube, undefined);                   // BBB's footer — dropped
  assert.equal(p.socials.linkedin, undefined);                  // BBB's footer — dropped
});

test('parseBbbSearchJson tolerates multiple API shapes', () => {
  const a = d.parseBbbSearchJson({ results: [
    { businessName: 'Reliable Plumbing Services', reportUrl: '/us/co/aurora/profile/plumber/reliable-0000', phone: '(720) 404-1160', address: { city: 'Aurora', state: 'CO' } },
  ] });
  assert.equal(a.length, 1);
  assert.equal(a[0].name, 'Reliable Plumbing Services');
  assert.equal(a[0].url, 'https://www.bbb.org/us/co/aurora/profile/plumber/reliable-0000');
  assert.equal(a[0].city, 'Aurora');

  const b = d.parseBbbSearchJson({ businesses: [{ name: 'Acme', url: 'https://www.bbb.org/us/co/denver/profile/handyman/acme' }] });
  assert.equal(b[0].name, 'Acme');
  assert.equal(b[0].url, 'https://www.bbb.org/us/co/denver/profile/handyman/acme');

  assert.deepEqual(d.parseBbbSearchJson({ nope: true }), []);
  assert.deepEqual(d.parseBbbSearchJson('not json'), []);
});

test('parseBbbSearchHtml extracts /profile/ links as candidates', () => {
  const html = `
    <a href="/us/co/aurora/profile/plumber/reliable-plumbing-0000">Reliable Plumbing Services</a>
    <a href="https://www.bbb.org/us/co/denver/profile/handyman/acme-1111"><span>Acme</span> Handyman</a>
    <a href="/us/co/aurora/profile/plumber/reliable-plumbing-0000">dup</a>
    <a href="/some/other/page">Not a profile</a>`;
  const c = d.parseBbbSearchHtml(html);
  assert.equal(c.length, 2); // deduped, only /profile/ links
  assert.equal(c[0].url, 'https://www.bbb.org/us/co/aurora/profile/plumber/reliable-plumbing-0000');
  assert.equal(c[0].name, 'Reliable Plumbing Services');
  assert.equal(c[1].name, 'Acme Handyman');
});

test('buildBbbApiUrl encodes business name + city/state', () => {
  const url = d.buildBbbApiUrl({ business_name: 'Reliable Plumbing Services', city: 'Aurora, CO' });
  assert.ok(url.startsWith('https://www.bbb.org/api/search?'));
  const q = new URL(url).searchParams;
  assert.equal(q.get('find_text'), 'Reliable Plumbing Services');
  assert.equal(q.get('find_loc'), 'aurora, co');
  assert.equal(q.get('find_country'), 'USA');
});

test('signalStr renders matched signals', () => {
  assert.equal(d.signalStr({ name: true, city: true, phone: false }), 'name+city');
  assert.equal(d.signalStr({ name: false, city: false, phone: false }), 'none');
});
