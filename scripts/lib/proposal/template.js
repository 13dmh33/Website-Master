'use strict';
/**
 * Renders a one-page, phone-skimmable proposal. Gap Selling framing:
 * current state (their words) -> cost of inaction -> future state ->
 * recommended package -> single clear CTA.
 *
 * Brand rules enforced here: no emojis, sentence case, no "business days"
 * language, no founder name hardcoded (signature name comes from an env
 * var, passed in — this module has no env access of its own), "AI agent"
 * never "bot" wherever Nora is mentioned.
 */

const { getPackage } = require('./packages');

function usd(n) {
  return `$${n.toLocaleString('en-US')}`;
}

function lineItemsHtml(pkg, customLineItems) {
  const rows = [
    { label: `${pkg.label} setup`, amountUsd: pkg.setupFeeUsd },
    ...(customLineItems || []),
  ];
  const rowsHtml = rows.map(item => `
    <tr>
      <td>${item.label}</td>
      <td class="amount">${usd(item.amountUsd)}</td>
    </tr>`).join('');
  const monthlyRow = pkg.monthlyUsd > 0 ? `
    <tr>
      <td>Monthly, starting once live</td>
      <td class="amount">${usd(pkg.monthlyUsd)}/mo</td>
    </tr>` : '';
  const total = rows.reduce((sum, r) => sum + r.amountUsd, 0);
  return { rowsHtml: rowsHtml + monthlyRow, total };
}

function featuresHtml(pkg) {
  return pkg.features.map(f => `<li>${f}</li>`).join('');
}

/**
 * renderProposal({ input, businessName, signatureName, calcomLink, stripeUrl, trackingPixelUrl })
 * Pure — no file/network access. Returns an HTML string.
 * trackingPixelUrl, if provided, is embedded as a 1x1 image so
 * netlify/functions/proposal-open.js can record an open — see
 * scripts/lib/proposal/open-pixel.js. Omitted entirely (no <img> tag) when
 * not provided, so a proposal generated without a deployed pixel endpoint
 * never references a broken URL.
 */
function renderProposal({ input, businessName, signatureName, calcomLink, stripeUrl, trackingPixelUrl }) {
  const pkg = getPackage(input.package);
  const offering = input.offering || input.trade;
  const { rowsHtml, total } = lineItemsHtml(pkg, input.customLineItems);
  const noteHtml = input.personalNote
    ? `<p class="note">${input.personalNote}</p>`
    : '';
  const ctaHtml = stripeUrl
    ? `<a class="cta" href="${stripeUrl}">Get started — ${usd(pkg.setupFeeUsd)} to begin</a>`
    : `<p class="cta-pending">Payment link pending — see your proposal draft for next steps.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposal for ${businessName}</title>
<style>
  :root {
    --navy: #0A1228; --teal: #00C8AF; --deep-teal: #008870;
    --white: #FFFFFF; --muted: #8BA8C4; --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  body {
    background: var(--navy); color: var(--white);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 2rem 1.25rem 3rem; line-height: 1.55;
  }
  .wrap { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  .subhead { color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }
  h2 { font-size: 1rem; color: var(--teal); margin: 2rem 0 0.5rem; }
  p { margin: 0 0 1rem; }
  .pain { background: rgba(255,255,255,0.03); border-left: 3px solid var(--teal); padding: 0.9rem 1.1rem; border-radius: 4px; }
  ul.features { margin: 0.5rem 0 0; padding-left: 1.2rem; color: var(--muted); font-size: 0.92rem; }
  ul.features li { margin-bottom: 0.4rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.92rem; }
  td { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  td.amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td { border-bottom: none; border-top: 1px solid var(--border); font-weight: 600; padding-top: 0.75rem; }
  .cta {
    display: block; text-align: center; background: var(--teal); color: var(--navy);
    font-weight: 700; text-decoration: none; padding: 0.9rem 1rem; border-radius: 8px;
    margin: 1.75rem 0 0.75rem;
  }
  .cta-pending { color: var(--muted); font-style: italic; }
  .secondary-cta { display: block; text-align: center; color: var(--muted); font-size: 0.88rem; text-decoration: underline; }
  .note { color: var(--muted); font-style: italic; font-size: 0.9rem; margin-top: 1.5rem; }
  .sign-off { margin-top: 2rem; font-size: 0.92rem; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>A plan for ${businessName}</h1>
    <div class="subhead">Following up on our call — here's what I'd recommend.</div>

    <h2>What you told me</h2>
    <div class="pain"><p style="margin:0">${input.painPoint}</p></div>

    <h2>What that's costing you</h2>
    <p>Every missed or unanswered ${offering} inquiry is a job that goes to whoever answers first — usually a competitor. That adds up fast, week over week.</p>

    <h2>Where this gets you</h2>
    <p>${pkg.description}</p>
    <ul class="features">${featuresHtml(pkg)}</ul>

    <h2>The numbers</h2>
    <table>
      ${rowsHtml}
      <tr class="total-row"><td>Due to start</td><td class="amount">${usd(total)}</td></tr>
    </table>

    ${ctaHtml}
    ${calcomLink ? `<a class="secondary-cta" href="${calcomLink}">Prefer to talk it through first? Grab 15 minutes.</a>` : ''}

    ${noteHtml}
    <div class="sign-off">— ${signatureName}</div>
  </div>
  ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none">` : ''}
</body>
</html>`;
}

module.exports = { renderProposal, usd };
