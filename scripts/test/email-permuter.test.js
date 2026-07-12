const test = require('node:test');
const assert = require('node:assert/strict');

const p = require('../email-permuter');

test('parsePersonName handles titles, middle initials, suffixes', () => {
  assert.deepEqual(p.parsePersonName('Mike Ramirez'), { first: 'mike', last: 'ramirez' });
  assert.deepEqual(p.parsePersonName('Mr. John A. Smith Jr.'), { first: 'john', last: 'smith' });
  assert.deepEqual(p.parsePersonName("Mary O'Brien"), { first: 'mary', last: "o'brien" });
  // NOTE: it takes first+last of any 2-token string — the caller must pass a vetted
  // PERSON name (contact-scraper's cleanName already gates that), not a business name.
  assert.deepEqual(p.parsePersonName('John Smith Plumbing'), { first: 'john', last: 'plumbing' });
});

test('parsePersonName rejects non-person / single-token input', () => {
  assert.equal(p.parsePersonName('Owner'), null);
  assert.equal(p.parsePersonName(''), null);
  assert.equal(p.parsePersonName('J'), null);
});

test('permutations are ranked, deduped, and domain-scoped', () => {
  const c = p.permutations('Mike Ramirez', 'acmehandyman.com');
  const emails = c.map(x => x.email);
  assert.equal(c[0].email, 'mike.ramirez@acmehandyman.com'); // most common first
  assert.ok(emails.includes('mike@acmehandyman.com'));
  assert.ok(emails.includes('mramirez@acmehandyman.com'));
  assert.ok(emails.includes('miker@acmehandyman.com'));
  assert.ok(emails.includes('ramirez@acmehandyman.com'));
  assert.equal(new Set(emails).size, emails.length); // no dupes
  assert.ok(c.every((x, i) => x.rank === i));
});

test("permutations strip apostrophes/hyphens from localparts", () => {
  const c = p.permutations("Mary O'Brien", 'example.com');
  assert.equal(c[0].email, 'mary.obrien@example.com');
  assert.ok(c.every(x => /^[a-z0-9._]+@example\.com$/.test(x.email)));
});

test('permutations returns [] without a usable name or domain', () => {
  assert.deepEqual(p.permutations('Owner', 'x.com'), []);
  assert.deepEqual(p.permutations('Mike Ramirez', ''), []);
});

test('domainOf reads the shared websiteOf/normHost', () => {
  assert.equal(p.domainOf({ website: 'https://www.AcmeHandyman.com/contact' }), 'acmehandyman.com');
  assert.equal(p.domainOf({ website: 'none' }), null);
  assert.equal(p.domainOf({ site_url: 'reliableplumbingco.com' }), 'reliableplumbingco.com');
});

test('isFreeMailDomain flags consumer mail hosts', () => {
  assert.ok(p.isFreeMailDomain('gmail.com'));
  assert.ok(p.isFreeMailDomain('YAHOO.COM'));
  assert.ok(!p.isFreeMailDomain('acmehandyman.com'));
});

test('confidenceFor ranks verified > mx-top > mx-lower > no-mx', () => {
  const verified = p.confidenceFor({ rank: 3, mx: true, verified: true });
  const mxTop    = p.confidenceFor({ rank: 0, mx: true, verified: false });
  const mxLower  = p.confidenceFor({ rank: 5, mx: true, verified: false });
  const noMx     = p.confidenceFor({ rank: 0, mx: false, verified: false });
  assert.ok(verified > mxTop);
  assert.ok(mxTop > mxLower);
  assert.ok(mxLower > noMx);
  assert.equal(verified, 0.95);
});
