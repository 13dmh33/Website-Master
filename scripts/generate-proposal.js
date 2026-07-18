#!/usr/bin/env node
/**
 * Post-call proposal generator — the anchor of this session's work.
 *
 * Usage:
 *   node scripts/generate-proposal.js <leadId>
 *   node scripts/generate-proposal.js <leadId> --no-stripe   # skip Stripe even if a key is configured
 *
 * Reads:  proposals/inputs/<leadId>.json (see proposals/inputs/README.md)
 *         queue/<leadId>-brief.json (for business_name)
 *         state.json (to confirm the lead exists before recording)
 * Writes: proposals/out/<leadId>.html (always, for local review)
 *         state.json (additive: proposalSentAt/proposalPackage/proposalAmount/stripeSessionId)
 *         Zoho Drafts (default) or sends via SMTP if PROPOSAL_SEND_LIVE=true
 *
 * Env:
 *   STRIPE_SECRET_KEY    — if unset, the proposal still generates with a
 *                          "payment link pending" CTA instead of failing.
 *   SIGNATURE_NAME        — required. No founder name is hardcoded anywhere
 *                          in this pipeline; this is how the sign-off gets set.
 *   ZOHO_EMAIL / ZOHO_APP_PASSWORD — required for delivery.
 *   PROPOSAL_SEND_LIVE    — default off. On: sends via SMTP. Off: Drafts only.
 *   CALCOM_LINK           — optional, defaults to the live booking link.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');

const { loadProposalInput } = require('./lib/proposal/load-input');
const { renderProposal } = require('./lib/proposal/template');
const { buildCheckoutSessionParams, createCheckoutSession } = require('./lib/proposal/stripe');
const { getPackage } = require('./lib/proposal/packages');
const { deliverProposal } = require('./lib/proposal/draft-mail');
const { recordProposalSent } = require('./lib/proposal/state');

const ROOT = path.join(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'queue');
const OUT_DIR = path.join(ROOT, 'proposals', 'out');

const DEFAULT_CALCOM_LINK = 'https://cal.com/david-hettinger-g8qbdk/30min';
const DEFAULT_PIXEL_BASE = 'https://trevoadvisors.com/.netlify/functions/proposal-open';

function loadBrief(leadId) {
  const briefPath = path.join(QUEUE_DIR, `${leadId}-brief.json`);
  if (!fs.existsSync(briefPath)) {
    throw new Error(`No brief found for lead "${leadId}" at ${briefPath} — cannot determine business name.`);
  }
  return JSON.parse(fs.readFileSync(briefPath, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  const leadId = args[0];
  const skipStripe = args.includes('--no-stripe');

  if (!leadId) {
    console.error('Usage: node scripts/generate-proposal.js <leadId> [--no-stripe]');
    process.exit(1);
  }

  const signatureName = process.env.SIGNATURE_NAME;
  if (!signatureName) {
    console.error('SIGNATURE_NAME is not set in .env.local — refusing to generate an unsigned proposal.');
    process.exit(1);
  }

  const input = loadProposalInput(leadId);
  const brief = loadBrief(leadId);
  const pkg = getPackage(input.package);
  const calcomLink = process.env.CALCOM_LINK || DEFAULT_CALCOM_LINK;

  let stripeUrl = null;
  let stripeSessionId = null;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!skipStripe) {
    if (!stripeKey) {
      console.log('STRIPE_SECRET_KEY not set — proposal will show a pending-payment-link CTA. See STATE-AUDIT.md.');
    } else {
      const params = buildCheckoutSessionParams({
        leadId, packageId: input.package, businessName: brief.business_name,
        customLineItems: input.customLineItems,
      });
      const session = await createCheckoutSession(params, stripeKey);
      stripeUrl = session.url;
      stripeSessionId = session.id;
      console.log(`Stripe Checkout Session created: ${session.id}`);
    }
  }

  const pixelBase = process.env.PROPOSAL_PIXEL_BASE || DEFAULT_PIXEL_BASE;
  const trackingPixelUrl = `${pixelBase}?leadId=${encodeURIComponent(leadId)}`;

  const html = renderProposal({
    input, businessName: brief.business_name, signatureName, calcomLink, stripeUrl, trackingPixelUrl,
  });

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${leadId}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath}`);

  const live = process.env.PROPOSAL_SEND_LIVE === 'true';
  const subject = `A plan for ${brief.business_name}`;
  const delivery = await deliverProposal({
    from: process.env.ZOHO_EMAIL,
    to: brief.email,
    subject,
    html,
    zohoEmail: process.env.ZOHO_EMAIL,
    zohoAppPassword: process.env.ZOHO_APP_PASSWORD,
    live,
  });
  console.log(`Delivery: ${delivery.mode}${delivery.mode === 'draft' ? ' (Zoho Drafts — review before sending)' : ''}`);

  // Custom line items count toward the due-today amount, same math as the template.
  const customTotal = (input.customLineItems || []).reduce((sum, i) => sum + i.amountUsd, 0);
  const amountUsd = pkg.setupFeeUsd + customTotal;
  recordProposalSent(leadId, { packageId: input.package, amountUsd, stripeSessionId });
  console.log(`Recorded to state.json: package=${input.package} amount=$${amountUsd} stripeSessionId=${stripeSessionId || 'none'}`);
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
