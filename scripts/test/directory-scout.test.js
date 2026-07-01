const test = require('node:test');
const assert = require('node:assert/strict');

const { formatLead, dedupAndFormat, toCsv, hostFromUrl } = require('../lib/directory-scout');
const yp  = require('../lib/dir-yellowpages');
const bbb = require('../lib/dir-bbb');
const lic = require('../lib/dir-licensing');

// ── directory-scout: formatLead ───────────────────────────────────────────────

test('formatLead — builds a pipeline-shaped record with slugged lead_id', () => {
  const l = formatLead(
    { business_name: "Joe's Plumbing", site_url: 'http://joesplumbing.com', phone: '(303) 555-1212', review_count: 42, rating: 4.7, address: '12 Main St' },
    { trade: 'plumber', city: 'Denver, CO', source: 'yellowpages' }
  );
  assert.equal(l.lead_id, 'joe-s-plumbing-denver-co'); // slugify turns the apostrophe into a hyphen (same as scout-has-website)
  assert.equal(l.business_name, "Joe's Plumbing");
  assert.equal(l.site_url, 'http://joesplumbing.com');
  assert.equal(l.trade, 'plumber');
  assert.equal(l.source, 'directory:yellowpages');
  assert.equal(l.place_id, null);
  assert.equal(l.gap_score, 0); // Diagnoser sorts on this — must exist
});

test('formatLead — strips platform-only "websites" to empty site_url', () => {
  const l = formatLead(
    { business_name: 'ACME Drains', site_url: 'https://facebook.com/acmedrains' },
    { trade: 'plumber', city: 'Denver', source: 'yellowpages' }
  );
  assert.equal(l.site_url, ''); // facebook is not a real site
});

test('formatLead — lowercases email', () => {
  const l = formatLead(
    { business_name: 'X', email: 'Owner@Example-Plumbing.com' },
    { trade: 'plumber', city: 'Denver', source: 'bbb' }
  );
  assert.equal(l.email, 'owner@example-plumbing.com');
});

// ── directory-scout: dedupAndFormat ───────────────────────────────────────────

test('dedupAndFormat — splits usable vs needs-email, dedups by id and domain', () => {
  const raw = [
    { business_name: 'Has Site',  site_url: 'http://hassite.com' },
    { business_name: 'Has Email', email: 'a@b.com' },
    { business_name: 'Phone Only', phone: '555' },
    { business_name: 'Dup Domain', site_url: 'https://www.hassite.com/contact' }, // same domain as #1
    { business_name: 'Has Site', site_url: 'http://other.com' },                  // same lead_id as #1
    { business_name: '' },                                                        // no name
  ];
  const { leads, needsEmail, disc } = dedupAndFormat(raw, {
    trade: 'plumber', city: 'Denver', source: 'yellowpages',
    knownIds: new Set(), knownDomains: new Set(),
  });
  assert.deepEqual(leads.map(l => l.business_name), ['Has Site', 'Has Email']);
  assert.deepEqual(needsEmail.map(l => l.business_name), ['Phone Only']);
  assert.equal(disc.noName, 1);
  assert.equal(disc.duplicate, 2); // dup domain + dup id
});

test('dedupAndFormat — respects pre-known ids and domains', () => {
  const raw = [
    { business_name: 'Known By Id',     site_url: 'http://newsite.com' },
    { business_name: 'Known By Domain', site_url: 'http://known.com' },
    { business_name: 'Fresh Lead',      site_url: 'http://fresh.com' },
  ];
  const { leads, disc } = dedupAndFormat(raw, {
    trade: 'plumber', city: 'Denver', source: 'bbb',
    knownIds: new Set(['known-by-id-denver']),
    knownDomains: new Set(['known.com']),
  });
  assert.deepEqual(leads.map(l => l.business_name), ['Fresh Lead']);
  assert.equal(disc.duplicate, 2);
});

test('toCsv — escapes quotes and commas', () => {
  const csv = toCsv([formatLead(
    { business_name: 'Joe, "The" Plumber', site_url: 'http://x.com', email: 'j@x.com' },
    { trade: 'plumber', city: 'Denver', source: 'yp' }
  )]);
  const [header, row] = csv.split('\n');
  assert.match(header, /^business_name,trade,city/);
  assert.match(row, /"Joe, ""The"" Plumber"/);
});

test('hostFromUrl — normalizes to registrable domain', () => {
  assert.equal(hostFromUrl('https://www.Example.com/contact?x=1'), 'example.com');
  assert.equal(hostFromUrl(''), null); // empty guard (a bare word is a valid hostname, so not tested here)
});

// ── Yellow Pages parser ───────────────────────────────────────────────────────

const YP_HTML = `
<div class="search-results organic">
  <div class="result">
    <a class="business-name" href="/mip/joes-plumbing-123"><span>Joe's Plumbing &amp; Drain</span></a>
    <div class="ratings"><span class="count">(128)</span></div>
    <div class="phones phone primary">(303) 555-0100</div>
    <a class="track-visit-website" href="https://joesplumbingdenver.com" target="_blank">Visit Website</a>
    <div class="street-address">100 Main St</div>
    <div class="locality">Denver, CO 80202</div>
  </div>
  <div class="result">
    <a class="business-name" href="/mip/acme-2"><span>ACME Rooter</span></a>
    <div class="phones phone primary">(303) 555-0200</div>
    <a href="https://acmerooter.com" class="track-visit-website">Visit Website</a>
  </div>
  <div class="result">
    <a class="business-name" href="/mip/nolink-3">No Website Plumbing</a>
    <div class="phones phone primary">(303) 555-0300</div>
  </div>
</div>`;

test('YP parseListings — extracts name, website, phone, reviews, address', () => {
  const rows = yp.parseListings(YP_HTML);
  assert.equal(rows.length, 3);

  assert.equal(rows[0].business_name, "Joe's Plumbing & Drain"); // entity-decoded
  assert.equal(rows[0].site_url, 'https://joesplumbingdenver.com');
  assert.equal(rows[0].phone, '(303) 555-0100');
  assert.equal(rows[0].review_count, 128);
  assert.equal(rows[0].address, '100 Main St, Denver, CO 80202');

  // href-before-class attribute order still resolves
  assert.equal(rows[1].site_url, 'https://acmerooter.com');

  // no "Visit Website" anchor → empty site_url (routes to needs-email later)
  assert.equal(rows[2].site_url, '');
  assert.equal(rows[2].business_name, 'No Website Plumbing');
});

test('YP parseListings — empty input is safe', () => {
  assert.deepEqual(yp.parseListings(''), []);
  assert.deepEqual(yp.parseListings(null), []);
});

// ── BBB parser ────────────────────────────────────────────────────────────────

test('BBB parseListings — reads JSON API results (string or object)', () => {
  const payload = {
    searchResult: [
      { businessName: 'Reliable Electric', phone: '(512) 555-1000', website: 'http://reliableelectric.com', address: '5 Oak', city: 'Austin', state: 'TX', stars: 4.5 },
      { businessName: 'No Site Electric', phone: '(512) 555-2000', city: 'Austin', state: 'TX' },
    ],
  };
  const fromObj = bbb.parseListings(payload);
  const fromStr = bbb.parseListings(JSON.stringify(payload));
  assert.deepEqual(fromObj, fromStr);

  assert.equal(fromObj.length, 2);
  assert.equal(fromObj[0].business_name, 'Reliable Electric');
  assert.equal(fromObj[0].site_url, 'http://reliableelectric.com');
  assert.equal(fromObj[0].rating, 4.5);
  assert.equal(fromObj[0].address, '5 Oak, Austin, TX');
  assert.equal(fromObj[1].site_url, ''); // no website in payload → empty
});

test('BBB parseListings — tolerates alternate results key + missing fields', () => {
  const rows = bbb.parseListings({ results: [{ name: 'Alt Key Co', primaryPhone: '555' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].business_name, 'Alt Key Co');
  assert.equal(rows[0].phone, '555');
});

test('BBB parseListings — invalid JSON string → []', () => {
  assert.deepEqual(bbb.parseListings('<html>not json</html>'), []);
});

// ── Licensing CSV parser ──────────────────────────────────────────────────────

test('licensing parseListings — fuzzy-maps varied headers, handles quoted commas', () => {
  const csv =
    'License #,Company Name,Business Phone,Email Address,Mailing Address\n' +
    '123,"Lone Star Plumbing, LLC",(512) 555-0001,owner@lonestar.com,"1 Riverside, Austin TX"\n' +
    '124,Hill Country Rooter,(512) 555-0002,,42 Hill Rd\n';
  const rows = lic.parseListings(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].business_name, 'Lone Star Plumbing, LLC'); // quoted comma preserved
  assert.equal(rows[0].phone, '(512) 555-0001');
  assert.equal(rows[0].email, 'owner@lonestar.com');
  assert.equal(rows[0].address, '1 Riverside, Austin TX');
  assert.equal(rows[1].email, ''); // blank email OK
});

test('licensing parseListings — no identifiable business column → []', () => {
  assert.deepEqual(lic.parseListings('foo,bar\n1,2\n'), []);
});

test('licensing parseListings — empty input → []', () => {
  assert.deepEqual(lic.parseListings(''), []);
  assert.deepEqual(lic.parseListings('Company Name\n'), []); // header only
});
