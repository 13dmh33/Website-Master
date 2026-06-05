#!/usr/bin/env node
/**
 * Warm Lead — instant follow-up generator for cold call / text responses
 *
 * After Dave calls or texts a contractor who says "sure, send me something,"
 * this generates a personalized follow-up text + email on the spot.
 *
 * Usage:
 *   node scripts/warm-lead.js \
 *     --name "Peak Flow Plumbing" \
 *     --trade plumber \
 *     --city "Denver, CO" \
 *     --reviews 47 \
 *     --phone "+1 303-555-1234"
 *
 *   # short form:
 *   node scripts/warm-lead.js -n "Volt & Wire Electric" -t electrician -c "Denver, CO" -r 23
 */

const args  = process.argv.slice(2);
const getArg = (long, short) => {
  for (const flag of [long, short].filter(Boolean)) {
    const i = args.indexOf(flag);
    if (i !== -1 && args[i + 1]) return args[i + 1];
  }
  return null;
};

const bizName  = getArg('--name',    '-n');
const trade    = getArg('--trade',   '-t');
const city     = getArg('--city',    '-c');
const reviews  = parseInt(getArg('--reviews', '-r') || '0', 10);
const phone    = getArg('--phone',   '-p');
const email    = getArg('--email',   '-e');

if (!bizName || !trade || !city) {
  console.error('Usage: node scripts/warm-lead.js --name "Biz Name" --trade plumber --city "Denver, CO" --reviews 47');
  console.error('Short: node scripts/warm-lead.js -n "Biz" -t electrician -c "Denver, CO" -r 23');
  process.exit(1);
}

// ── DATA ──────────────────────────────────────────────────────────────────────

const cityShort = city.split(',')[0].trim();

const TRADE_LABELS = {
  plumber:     'plumber',
  hvac:        'HVAC contractor',
  electrician: 'electrician',
  roofer:      'roofer',
  handyman:    'handyman',
};

const DEMO_LINKS = {
  plumber:     'https://trevoadvisors.com/demos/plumbing/',
  hvac:        'https://trevoadvisors.com/demos/hvac/',
  electrician: 'https://trevoadvisors.com/demos/electrical/',
  roofer:      'https://trevoadvisors.com/demos/roofing/',
  handyman:    'https://trevoadvisors.com/demos/handyman/',
};

// ── PERSONALIZED URL ──────────────────────────────────────────────────────────

function buildForUrl() {
  const params = new URLSearchParams({
    b: bizName,
    t: trade,
    c: cityShort,
  });
  if (reviews) params.set('r', String(reviews));
  return `https://trevoadvisors.com/for/?${params.toString()}`;
}

// ── MESSAGES ─────────────────────────────────────────────────────────────────

function buildFollowUpText() {
  const forUrl  = buildForUrl();
  const demo    = DEMO_LINKS[trade] || 'https://trevoadvisors.com/demos/';
  const reviewLine = reviews >= 20
    ? `You've got ${reviews} Google reviews — that's real social proof most ${TRADE_LABELS[trade] || trade}s don't have.`
    : `${reviews > 0 ? `You have ${reviews} reviews` : 'Your Google presence'} is a solid foundation.`;

  return `Hey! Here's that link I mentioned — this is what a site for ${bizName} would look like:

${forUrl}

${reviewLine} A website turns that into actual calls instead of missed opportunities.

$150 flat, live in 3 days. If you want to move forward, just reply and I'll send you the intake form. No pressure either way. — Dave @ Trevo Advisors`;
}

function buildFollowUpEmail(toEmail) {
  const forUrl = buildForUrl();
  const demo   = DEMO_LINKS[trade] || 'https://trevoadvisors.com/demos/';
  const tradeLabel = TRADE_LABELS[trade] || trade;

  const subject = `Your site preview — ${bizName} | Trevo Advisors`;

  const body = `Hi,

Thanks for taking my call earlier. Here's the site preview I mentioned:

${forUrl}

This shows you what a custom ${tradeLabel} website for ${bizName} would look like in ${cityShort} — mobile-optimized, click-to-call on every page, your Google reviews displayed prominently.

What's included:
- Custom 5–7 page site for your trade
- Click-to-call on every page
- Google reviews section
- Lead capture form → goes straight to your email
- SEO foundation built in
- Live in 3 business days

One-time cost: $150. Hosting after that: $65/mo. No contracts.

If you'd like to go ahead, here's the checkout link:
https://trevoadvisors.com/checkout/

And if you want to add an AI agent (auto-replies to texts/leads 24/7), that's $200 total instead of $150:
https://trevoadvisors.com/atlas/

Happy to jump on a quick call to answer any questions. Just reply here.

— Dave
Trevo Advisors
dave@trevoadvisors.com
(720) 902-7555`;

  return { subject, body };
}

function buildD2Text() {
  return `Hey — just circling back on the website for ${bizName}. Did you get a chance to check out the preview? Still happy to move forward if the timing is right. — Dave @ Trevo Advisors`;
}

// ── OUTPUT ────────────────────────────────────────────────────────────────────

function hr(char = '─', n = 60) { return char.repeat(n); }

function main() {
  const forUrl  = buildForUrl();
  const followText = buildFollowUpText();
  const { subject, body } = buildFollowUpEmail(email || '[their email]');
  const d2 = buildD2Text();

  console.log(`\n${hr('═')}`);
  console.log(`WARM LEAD: ${bizName}`);
  console.log(`${trade} · ${city}${reviews ? ` · ${reviews} reviews` : ''}${phone ? ` · ${phone}` : ''}`);
  console.log(hr('═'));

  console.log('\n[ PERSONALIZED DEMO LINK ]');
  console.log(forUrl);

  console.log('\n[ FOLLOW-UP TEXT — send within 1 hour of call ]');
  console.log(hr());
  console.log(followText);
  console.log(hr());

  if (email) {
    console.log('\n[ FOLLOW-UP EMAIL ]');
    console.log(`To:      ${email}`);
    console.log(`Subject: ${subject}`);
    console.log(hr());
    console.log(body);
    console.log(hr());
  } else {
    console.log('\n[ No email provided — add --email to generate email copy ]');
  }

  console.log('\n[ D+2 FOLLOW-UP TEXT — if no reply in 48 hours ]');
  console.log(hr());
  console.log(d2);
  console.log(hr());

  console.log('\n[ NEXT STEPS ]');
  console.log('  Day 0  → send follow-up text immediately after call');
  if (email) console.log('  Day 0  → send follow-up email within 2 hours');
  console.log('  Day 2  → if no reply, send D+2 text above');
  console.log('  Day 5  → if still nothing, call again (voicemail is fine)');
  console.log('  Day 10 → move to drip sequence or mark "cold"');
  console.log();
}

main();
