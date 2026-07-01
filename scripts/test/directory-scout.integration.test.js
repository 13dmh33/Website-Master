/**
 * End-to-end LOGIC test for the directory-scout → contact-scraper chain, run
 * fully offline against realistic fixtures. It cannot prove the LIVE selectors
 * match today's Yellow Pages markup (that needs a Mac fetch — the container's
 * egress proxy 403s all external sites), but it proves that IF a fetch returns
 * the expected shape, the whole pipeline produces website+email leads. Combined
 * with the runner's --html offline mode, this is the strongest pre-flight check
 * available from the container.
 *
 * Chain under test:
 *   YP results HTML  → yp.parseListings         → rawListings (name + site_url)
 *                    → dedupAndFormat           → pipeline leads (site_url set)
 *   contractor site  → contact-scraper.extractEmails + pickBest → owner email
 *   ⇒ a lead that has BOTH a website and an email (what the user wants tomorrow)
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const yp  = require('../lib/dir-yellowpages');
const { dedupAndFormat } = require('../lib/directory-scout');
const { extractEmails, pickBest, isJunk, findContactLinks } = require('../contact-scraper');

// ── Fixtures shaped like real markup ─────────────────────────────────────────

// A realistic Yellow Pages organic results block (current class names).
const YP_RESULTS = `
<div class="search-results organic">
  <div class="result" data-index="1">
    <div class="info">
      <h2 class="n"><a class="business-name" href="/mip/blue-ridge-plumbing-123"><span>Blue Ridge Plumbing</span></a></h2>
      <div class="ratings"><div class="result-rating"><span class="count">(87)</span></div></div>
    </div>
    <div class="info-section info-primary">
      <div class="phones phone primary">(704) 555-4400</div>
      <div class="street-address">210 Commerce St</div>
      <div class="locality">Charlotte, NC 28202</div>
    </div>
    <div class="links">
      <a class="track-visit-website" href="https://blueridgeplumbingnc.com" rel="nofollow noopener" target="_blank">Visit Website</a>
    </div>
  </div>
  <div class="result" data-index="2">
    <div class="info">
      <h2 class="n"><a class="business-name" href="/mip/queen-city-rooter-456"><span>Queen City Rooter</span></a></h2>
    </div>
    <div class="info-section info-primary">
      <div class="phones phone primary">(704) 555-7788</div>
    </div>
    <div class="links">
      <a class="track-visit-website" href="http://www.queencityrooter.com/" rel="nofollow">Visit Website</a>
    </div>
  </div>
</div>`;

// Same page, but YP has RENAMED the website class (simulated markup churn) — the
// firstExternalLink fallback must still recover the site from the external <a>.
const YP_RENAMED_CLASS = `
<div class="result">
  <a class="business-name" href="/mip/pinnacle-plumbing-789"><span>Pinnacle Plumbing</span></a>
  <div class="phones phone primary">(980) 555-0101</div>
  <a class="visit-site-btn" href="https://pinnacleplumbingclt.com" rel="nofollow" target="_blank">Website</a>
  <a class="track-visit-directions" href="https://www.yellowpages.com/directions?x=1">Directions</a>
</div>`;

// Realistic contractor contact page: mailto + a plain-text address, surrounded
// by the kind of junk the extractor must filter (schema.org, googleapis, a CDN,
// an @2x asset). pickBest should return the owner's on-domain personal address.
const CONTRACTOR_SITE = {
  'blueridgeplumbingnc.com': `
    <!doctype html><html><head>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter">
      <script type="application/ld+json">{"@context":"https://schema.org","email":"noreply@schema.org"}</script>
    </head><body>
      <header><img src="/logo@2x.png"></header>
      <section id="contact">
        <h1>Contact Blue Ridge Plumbing</h1>
        <p>Call (704) 555-4400 or email
           <a href="mailto:dave@blueridgeplumbingnc.com">dave@blueridgeplumbingnc.com</a></p>
        <p>General questions: info@blueridgeplumbingnc.com</p>
      </section>
      <footer>Site by <a href="https://someagency.com">Some Agency</a> ·
        <img src="https://cdn.cloudflare.com/track.gif?e=hash@2x"></footer>
    </body></html>`,
};

// ── The end-to-end chain ─────────────────────────────────────────────────────

test('E2E: YP results → leads with site_url', () => {
  const raw = yp.parseListings(YP_RESULTS);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].business_name, 'Blue Ridge Plumbing');
  assert.equal(raw[0].site_url, 'https://blueridgeplumbingnc.com');
  assert.equal(raw[0].review_count, 87);
  assert.equal(raw[0].phone, '(704) 555-4400');
  assert.equal(raw[1].site_url, 'http://www.queencityrooter.com/');

  const { leads } = dedupAndFormat(raw, {
    trade: 'plumber', city: 'Charlotte, NC', source: 'yellowpages',
    knownIds: new Set(), knownDomains: new Set(),
  });
  assert.equal(leads.length, 2);
  assert.equal(leads[0].site_url, 'https://blueridgeplumbingnc.com');
  assert.equal(leads[0].email, ''); // no email yet — contact-scraper fills it next
});

test('E2E: contractor site → contact-scraper extracts the owner email', () => {
  const html = CONTRACTOR_SITE['blueridgeplumbingnc.com'];
  const emails = extractEmails(html);

  // junk must be filtered
  assert.ok(!emails.filter(e => !isJunk(e)).includes('noreply@schema.org'));

  // pickBest should return the on-domain PERSONAL address, not the role address
  const best = pickBest(emails, 'blueridgeplumbingnc.com');
  assert.equal(best, 'dave@blueridgeplumbingnc.com');
});

test('E2E: full join — every YP lead with a site resolves to a website+email lead', () => {
  const raw = yp.parseListings(YP_RESULTS);
  const { leads } = dedupAndFormat(raw, {
    trade: 'plumber', city: 'Charlotte, NC', source: 'yellowpages',
    knownIds: new Set(), knownDomains: new Set(),
  });

  const enriched = leads.map(lead => {
    const host = lead.site_url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase();
    const html = CONTRACTOR_SITE[host];
    const email = html ? pickBest(extractEmails(html), host) : null;
    return { ...lead, email: email || lead.email };
  });

  const blueRidge = enriched.find(l => l.business_name === 'Blue Ridge Plumbing');
  assert.ok(blueRidge.site_url, 'has website');
  assert.equal(blueRidge.email, 'dave@blueridgeplumbingnc.com', 'has scraped email');
  // This lead now satisfies the pipeline's email channel (lead.email set) — exactly
  // what Diagnoser needs to route it as an email lead.
});

test('E2E resilience: YP renames its website class → fallback still recovers the site', () => {
  const raw = yp.parseListings(YP_RENAMED_CLASS);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].business_name, 'Pinnacle Plumbing');
  // the canonical class is gone, but firstExternalLink skips the YP directions
  // link and recovers the real site:
  assert.equal(raw[0].site_url, 'https://pinnacleplumbingclt.com');
});

test('E2E: contact-scraper finds the contact sub-page link on a homepage', () => {
  const homepage = `<html><body>
    <nav><a href="/about">About</a><a href="/contact-us">Contact Us</a></nav>
    <a href="https://facebook.com/x">fb</a>
  </body></html>`;
  const links = findContactLinks(homepage, 'https://blueridgeplumbingnc.com');
  assert.ok(links.some(u => /contact-us/.test(u)), 'follows the contact link');
});
