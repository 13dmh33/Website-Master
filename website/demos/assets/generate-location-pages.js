#!/usr/bin/env node
/* ============================================================
   Format 2: service×city programmatic SEO pages.
   Reads SiteConfig.addons.locationPages from each demo's index.html
   and writes a lightweight static page per entry at
   website/demos/<trade>/<service-city-slug>/index.html — same
   demo.css/demo.js engine, scoped to one service in one city.

   Run after editing a trade's addons.locationPages array:
     node website/demos/assets/generate-location-pages.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const DEMOS_DIR = path.join(__dirname, '..');
const TRADES = ['plumbing', 'electrical', 'handyman', 'roofing', 'hvac'];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function readConfig(trade) {
  const file = path.join(DEMOS_DIR, trade, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const m = html.match(/window\.SiteConfig = ({[\s\S]*?});\s*<\/script>/);
  if (!m) throw new Error('No SiteConfig found in ' + file);
  return eval('(' + m[1] + ')'); // eslint-disable-line no-eval
}

function formatPhone(phone) {
  const digits = phone.replace(/^\+1/, '');
  return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
}

function renderPage(trade, cfg, loc) {
  const biz = cfg.business;
  const phoneDisplay = formatPhone(biz.phone);
  const title = `${loc.service} in ${loc.city}, ${biz.region} | ${biz.name}`;
  const desc = `${loc.service} in ${loc.city}, ${biz.region} — ${biz.name} offers same-day service, licensed & insured, ${biz.rating}★ on Google. Call or text ${phoneDisplay}.`;
  const pageConfig = {
    business: Object.assign({}, biz, { areaServed: loc.city + ', ' + biz.region }),
    theme: cfg.theme,
    plan: cfg.plan,
    nora: cfg.nora,
    features: {
      emergency: false, urgency: false, ratingBadge: false, clickToText: true,
      badges: false, financing: false, gallery: false, about: false,
      membership: false, serviceArea: false, veteran: false, faq: false, leadForm: false
    }
  };

  return `<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${trade === 'hvac' ? '<meta name="robots" content="noindex, nofollow" />\n' : ''}<title>${title}</title>
<meta name="description" content="${desc}" />
<link rel="canonical" href="https://trevoadvisors.com/demos/${trade}/${loc.slug}/" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../../assets/demo.css" />
<style>
  :root {
    --accent: ${cfg.theme.accent};
    --accent-dark: ${cfg.theme.accentDark};
    --dark:   ${cfg.theme.dark};
    --light:  ${cfg.theme.light};
    --white:  #FFFFFF;
    --muted:  #6B8BA4;
    --border: rgba(255,255,255,0.1);
  }
</style>
</head>
<body>

<nav>
  <div class="nav-biz"><a href="../" style="color:inherit;text-decoration:none;">${biz.name}</a></div>
  <div class="nav-right">
    <span class="nav-phone">${phoneDisplay}</span>
    <a href="sms:${biz.phone}" class="nav-text">\u{1F4AC} Text us</a>
    <a href="#contact" class="nav-book">Book Now</a>
  </div>
</nav>

<section class="hero" style="min-height:60vh;">
  <div class="hero-bg" style="background-image:url('${biz.image}');"></div>
  <div class="hero-gradient"></div>
  <div class="hero-content">
    <span class="hero-badge">${loc.service} · ${loc.city}, ${biz.region}</span>
    <h1>${loc.service} in <span class="accent">${loc.city}</span></h1>
    <p class="hero-sub">Same-day service · Licensed &amp; insured · ${biz.rating}★ (${biz.reviewCount} reviews)</p>
    <div class="hero-btns">
      <a href="tel:${biz.phone}" class="btn-call">Call ${phoneDisplay}</a>
      <a href="sms:${biz.phone}" class="btn-text">\u{1F4AC} Text us</a>
      <a href="#contact" class="btn-estimate">Get free estimate</a>
    </div>
  </div>
</section>

<div class="trust-strip">
  <span class="trust-item">${biz.license ? 'Lic #' + biz.license + ' · Insured' : 'Insured &amp; Bonded'}</span>
  <span class="trust-item">Upfront Pricing</span>
  <span class="trust-item">Same-Day Available</span>
  <span class="trust-item">Serving ${loc.city}</span>
</div>

<section class="section">
  <div class="container">
    <div class="section-label">${loc.service}</div>
    <h2 class="section-h2">Why ${loc.city} homeowners call ${biz.name}</h2>
    <p class="section-sub">${biz.name} is a trusted, locally reviewed ${biz.trade.toLowerCase()} serving ${loc.city} and the surrounding area. Licensed, insured, and rated ${biz.rating}★ across ${biz.reviewCount} Google reviews.</p>
  </div>
</section>

<section class="lead-section" id="contact">
  <div class="container lead-grid">
    <div class="lead-copy">
      <div class="section-label">Get a free estimate</div>
      <h2 class="section-h2">Request ${loc.service.toLowerCase()} in ${loc.city}</h2>
      <p>Tell us what's going on and we'll text you back in minutes with availability and an upfront estimate.</p>
    </div>
    <form class="lead-form" novalidate>
      <div class="row">
        <div class="field"><label>Name</label><input type="text" name="name" required /></div>
        <div class="field"><label>Phone</label><input type="tel" name="phone" required /></div>
      </div>
      <div class="field"><label>What's going on?</label><textarea name="message" placeholder="Briefly describe the problem…"></textarea></div>
      <button type="submit" class="lead-submit">Text me a free estimate →</button>
    </form>
  </div>
</section>

<footer>
  <span class="biz-name">${biz.name}</span>
  <span>© 2025 ${biz.name} · ${loc.city}, ${biz.region} · <a href="../">← Back to ${biz.name}</a> · Powered by <a href="https://trevoadvisors.com">Trevo Advisors</a></span>
</footer>

<div class="mobile-cta-bar">
  <a href="tel:${biz.phone}" class="m-call">\u{1F4DE} Call</a>
  <a href="sms:${biz.phone}" class="m-text">\u{1F4AC} Text</a>
  <a href="#contact" class="m-quote">Free Quote</a>
</div>

<div class="floating-contact" id="floatingContact" hidden>
  <div class="fc-menu">
    <a href="tel:${biz.phone}" class="fc-item">\u{1F4DE} Call now</a>
    <a href="sms:${biz.phone}" class="fc-item">\u{1F4AC} Text us</a>
  </div>
  <button class="fc-toggle" aria-label="Contact us">\u{1F4DE}</button>
</div>

<script>
  window.SiteConfig = ${JSON.stringify(pageConfig, null, 2)};
</script>
<script src="../../assets/demo.js"></script>
</body>
</html>
`;
}

function run() {
  const created = [];
  TRADES.forEach((trade) => {
    const cfg = readConfig(trade);
    const locations = (cfg.addons && cfg.addons.locationPages) || [];
    locations.forEach((loc) => {
      const slug = loc.slug || slugify(loc.service + '-' + loc.city);
      const dir = path.join(DEMOS_DIR, trade, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderPage(trade, cfg, Object.assign({}, loc, { slug })));
      created.push(`${trade}/${slug}`);
    });
  });
  console.log(`Generated ${created.length} location page(s):\n` + created.join('\n'));
}

run();
