'use strict';

// build-linkpage.js — generates the link-in-bio hub (linkpage/index.html).
//
// This is the measurable choke point of the sales funnel: the Instagram bio
// link points here, every button out to the storefront is UTM-tagged, and an
// optional GA4 / Meta Pixel snippet (free) records clicks for attribution.
// It also captures emails (the highest-ROI owned channel) via a form.
//
// Deploy the linkpage/ folder to any free static host (Netlify / GitHub Pages /
// Cloudflare Pages) and set that URL as LINKPAGE_URL + the Instagram bio link.
//
// Zero cost. Re-run whenever the catalog or featured products change (the weekly
// pipeline does this automatically).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs    = require('fs');
const path  = require('path');
const store = require('../lib/store');
const links = require('../lib/links');

const GA_ID         = process.env.GA_MEASUREMENT_ID || '';
const PIXEL_ID      = process.env.META_PIXEL_ID || '';
const EMAIL_ACTION  = process.env.EMAIL_CAPTURE_ACTION || ''; // Formspree / Buttondown form endpoint

// brand palette (matches the scheduler preview + visual-config)
const C = { pink: '#FF2E88', charcoal: '#1A1A1D', card: '#232327', cream: '#F7F4F0', pinkLt: '#FFB3D1', yellow: '#FFC400' };

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function analyticsHead() {
  let out = '';
  if (GA_ID) {
    out += `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA_ID)}"></script>
  <script>
    window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
    gtag('js',new Date());gtag('config','${esc(GA_ID)}');
  </script>`;
  }
  if (PIXEL_ID) {
    out += `
  <script>
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init','${esc(PIXEL_ID)}');fbq('track','PageView');
  </script>`;
  }
  return out;
}

function emailForm() {
  if (!EMAIL_ACTION) {
    return `<p class="note">Newsletter signup goes here once an email form endpoint (Formspree / Buttondown, free) is set in EMAIL_CAPTURE_ACTION.</p>`;
  }
  return `
  <form class="signup" action="${esc(EMAIL_ACTION)}" method="POST">
    <label>First dibs on new drops 🩷</label>
    <div class="row">
      <input type="email" name="email" placeholder="you@email.com" required />
      <button type="submit">Join</button>
    </div>
    <span class="fine">No spam — just drops + the mission. Unsubscribe anytime.</span>
  </form>`;
}

function productButtons() {
  const catalog = store.getProductCatalog();
  if (!catalog.length) return '';
  return catalog.map(key => {
    const url = links.storeUrl({ campaign: 'linkpage', content: key });
    const onclick = (GA_ID || PIXEL_ID)
      ? ` onclick="${GA_ID ? `gtag('event','select_item',{item_id:'${esc(key)}'});` : ''}${PIXEL_ID ? `fbq('track','ViewContent',{content_ids:['${esc(key)}']});` : ''}"`
      : '';
    return `    <a class="btn product" href="${esc(url)}" target="_blank" rel="noopener"${onclick}>${esc(links.productName(key))}</a>`;
  }).join('\n');
}

function main() {
  const brand = store.getBrandVoice() || {};
  const shopAll = links.storeUrl({ campaign: 'linkpage', content: 'shop_all' });
  const oneLiner = brand.one_liner || 'Funny, high-quality apparel celebrating women in the trades.';

  const html = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Techs4Tatas</title>${analyticsHead()}
  <style>
    :root{--pink:${C.pink};--char:${C.charcoal};--card:${C.card};--cream:${C.cream};--pinkLt:${C.pinkLt};--yellow:${C.yellow};}
    *{box-sizing:border-box;} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--char);color:var(--cream);
      min-height:100vh;display:flex;justify-content:center;padding:2rem 1rem;}
    .wrap{width:100%;max-width:440px;text-align:center;}
    h1{color:var(--pink);font-size:2rem;margin:.25rem 0 0;letter-spacing:.02em;}
    .tag{color:var(--pinkLt);font-size:.95rem;margin:.4rem 0 1rem;line-height:1.4;}
    .badge{display:inline-block;background:rgba(255,46,136,.12);border:1px solid var(--pink);color:var(--pinkLt);
      font-size:.8rem;padding:.4rem .8rem;border-radius:999px;margin-bottom:1.5rem;}
    .btn{display:block;width:100%;padding:1rem;margin:.6rem 0;border-radius:12px;text-decoration:none;font-weight:600;
      background:var(--card);color:var(--cream);border:1px solid #333;transition:transform .08s ease,border-color .2s;}
    .btn:hover{transform:translateY(-2px);border-color:var(--pink);}
    .btn.primary{background:var(--pink);color:#1A1A1D;border-color:var(--pink);font-size:1.05rem;}
    .btn.product{font-size:.95rem;}
    .sec{color:var(--yellow);font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;margin:1.5rem 0 .4rem;}
    .signup{margin:1.75rem 0 .5rem;text-align:left;} .signup label{display:block;color:var(--pinkLt);font-size:.9rem;margin-bottom:.4rem;font-weight:600;}
    .signup .row{display:flex;gap:.5rem;} .signup input{flex:1;padding:.8rem;border-radius:10px;border:1px solid #333;background:var(--char);color:var(--cream);}
    .signup button{padding:.8rem 1.1rem;border:0;border-radius:10px;background:var(--pink);color:#1A1A1D;font-weight:700;cursor:pointer;}
    .signup .fine{display:block;color:#8a8a90;font-size:.72rem;margin-top:.4rem;}
    .note{color:#8a8a90;font-size:.8rem;border:1px dashed #444;border-radius:10px;padding:.75rem;margin-top:1.5rem;}
    footer{color:#8a8a90;font-size:.75rem;margin-top:2rem;}
  </style>
</head><body>
  <div class="wrap">
    <h1>Techs4Tatas</h1>
    <p class="tag">${esc(oneLiner)}</p>
    <span class="badge">🩷 30% of every profit funds breast cancer research</span>

    <a class="btn primary" href="${esc(shopAll)}" target="_blank" rel="noopener">Shop all 🔧</a>

    <div class="sec">Featured gear</div>
${productButtons()}

    ${emailForm()}

    <footer>Wear it loud. Fund the fight.</footer>
  </div>
</body></html>`;

  store.ensureDir(store.paths.linkpage);
  const out = path.join(store.paths.linkpage, 'index.html');
  fs.writeFileSync(out, html, 'utf8');

  console.log(`Linkpage built → ${out}`);
  console.log(`  Storefront: ${links.STOREFRONT}`);
  console.log(`  Bio link should point at: ${links.LINKPAGE}${links.LINKPAGE === links.STOREFRONT ? '  (set LINKPAGE_URL once the hub is hosted)' : ''}`);
  console.log(`  Analytics: GA4 ${GA_ID ? 'on' : 'off'} · Meta Pixel ${PIXEL_ID ? 'on' : 'off'} · Email form ${EMAIL_ACTION ? 'on' : 'off'}`);
}

main();
