#!/usr/bin/env node
/**
 * Referral — outreach generator for referral partners
 *
 * Targets professionals who regularly refer contractors to clients:
 * real estate agents, home inspectors, property managers, interior designers.
 *
 * Each referral partner is worth 2–4 contractor clients/month passively.
 * Zero cost — all logic is local.
 *
 * Usage:
 *   node scripts/referral.js                      # all partner types
 *   node scripts/referral.js --type realtor       # specific type
 *   node scripts/referral.js --city "Denver, CO"  # specific city (default: Denver)
 *
 * Output:
 *   reports/referral-{date}.csv
 *   Terminal preview + LinkedIn search URLs for each partner type
 */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');

const args      = process.argv.slice(2);
const getArg    = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const typeFilter = getArg('--type');
const cityArg    = getArg('--city') || 'Denver, CO';
const cityShort  = cityArg.split(',')[0].trim();

// ── PARTNER TYPES ─────────────────────────────────────────────────────────────

const PARTNER_TYPES = {
  realtor: {
    label:       'Real Estate Agent',
    linkedin_kw: `"real estate agent" "${cityShort}"`,
    google_q:    `real estate agent ${cityShort} CO Zillow`,
    why:         'agents refer contractors to every buyer + seller they work with',
    value:       '2–4 contractor referrals/month per active agent',
    connect_note: (city) =>
      `Hi — I build contractor websites for plumbers, HVAC, and electricians in ${city}. Your clients need trusted contractors — happy to refer your listings too. Worth connecting?`,
    followup_dm: (city) =>
      `Hey — thanks for connecting. Quick context: I work with home service contractors in ${city} (plumbers, HVAC, electricians) who need referral partners.\n\nI'd be happy to refer you to clients who mention moving or buying a home — and you can refer contractors who ask you for recommendations to me. No formal agreement needed — just a mutual "I know a good [X]" relationship.\n\nWorth a quick call? — Dave @ Trevo Advisors`,
    email_subject: (city) => `Contractor referral partnership — ${city}`,
    email_body: (city) =>
      `Hi,\n\nI'm Dave Hettinger with Trevo Advisors — I build websites for home service contractors (plumbers, HVAC, electricians, roofers) in ${city}.\n\nI'm building a referral network with local real estate agents. Your clients frequently need contractors, and my clients (contractors) frequently meet homeowners.\n\nI'd love to do a simple mutual referral arrangement — you send contractors my way when they ask about a website, I refer you when clients mention real estate.\n\nWould a 15-minute call make sense? — Dave\ndave@trevoadvisors.com | trevoadvisors.com`,
  },
  inspector: {
    label:       'Home Inspector',
    linkedin_kw: `"home inspector" "${cityShort}"`,
    google_q:    `home inspector ${cityShort} CO InterNACHI`,
    why:         'inspectors interact with contractors daily and often make direct referrals',
    value:       '1–3 referrals/month per inspector',
    connect_note: (city) =>
      `Hi — I build contractor websites in ${city}. You probably know every plumber and electrician in the area — I'd love to connect and compare notes. Mutual referrals?`,
    followup_dm: (city) =>
      `Hey — thanks for connecting. I work with home service contractors in ${city} who need a professional web presence. Your world and mine overlap a lot.\n\nIf you ever have a contractor client who asks about getting a website, send them my way — I'll do the same when contractors mention needing inspection referrals.\n\n$150 flat, live in 3 days. No pressure. Just want to be on your radar. — Dave`,
    email_subject: (city) => `Inspector + contractor website referrals — ${city}`,
    email_body: (city) =>
      `Hi,\n\nI'm Dave with Trevo Advisors. I build affordable websites for contractors in ${city} — $150 flat.\n\nI'm guessing you interact with plumbers, electricians, and HVAC techs regularly. If any of them ask about getting a website, I'd love the introduction. I'm happy to refer you when homeowners mention needing an inspection.\n\nSimple, low-pressure mutual referral arrangement. Interested? — Dave\ndave@trevoadvisors.com`,
  },
  property_manager: {
    label:       'Property Manager',
    linkedin_kw: `"property manager" "${cityShort}"`,
    google_q:    `property management company ${cityShort} CO`,
    why:         'PMs maintain vendor lists and place contractor work constantly',
    value:       'potentially a recurring B2B contract for multiple contractor sites',
    connect_note: (city) =>
      `Hi — I build contractor websites in ${city} — plumbers, HVAC, electricians. Property managers use these trades constantly. Curious if you'd want to share referrals. Worth connecting?`,
    followup_dm: (city) =>
      `Hey — thanks for the connection. I work with home service contractors in ${city} and I'm looking to build relationships with property managers.\n\nI build contractor websites ($150 flat) and can help contractors you already work with look more professional online. Sometimes that helps them get more work from other sources, which means more capacity for your properties too.\n\nAny contractors in your vendor network who might want a site? Happy to offer your referrals a discount. — Dave`,
    email_subject: (city) => `Contractor website referral — ${city} property managers`,
    email_body: (city) =>
      `Hi,\n\nI'm Dave with Trevo Advisors. I build contractor websites in ${city} — $150 flat, 3 days turnaround.\n\nProperty managers interact with contractors constantly. If any of your vendors mention needing a website, I'd appreciate the referral. I offer a $25 referral credit for any client you send.\n\nI can also build landing pages for your vendor relationships at a discount if that's useful. — Dave\ndave@trevoadvisors.com | trevoadvisors.com`,
  },
  designer: {
    label:       'Interior Designer',
    linkedin_kw: `"interior designer" "${cityShort}"`,
    google_q:    `interior designer ${cityShort} CO Houzz`,
    why:         'designers coordinate contractor work for renovations',
    value:       '1–2 high-value referrals/month (renovation projects = multiple contractors)',
    connect_note: (city) =>
      `Hi — I build contractor websites in ${city}. Plumbers, electricians, general contractors. You probably recommend contractors constantly — worth a quick connection?`,
    followup_dm: (city) =>
      `Hey — thanks for connecting! I build websites for home service contractors in ${city}. I imagine you refer plumbers, electricians, or general contractors to clients fairly often.\n\nIf they ever mention needing a website, I'd love the intro — $150 flat, 3 days, looks like it cost $3,000+. And if I have contractor clients who mention needing design help, I'll send them your way.\n\n— Dave @ Trevo Advisors`,
    email_subject: (city) => `Contractor referral partnership — ${city}`,
    email_body: (city) =>
      `Hi,\n\nI'm Dave with Trevo Advisors. I build websites for contractors in ${city} (plumbers, electricians, HVAC, general contractors) — $150 flat.\n\nI know designers recommend contractors to renovation clients regularly. I'd love to be a resource for your clients — and refer design clients your way when contractors mention needing design help.\n\nSimple mutual arrangement. Worth a quick chat? — Dave\ndave@trevoadvisors.com`,
  }
};

// ── LINKEDIN SEARCH ───────────────────────────────────────────────────────────

function linkedinUrl(keywords) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

function googleUrl(q) {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function escapeCsv(val) {
  const s = String(val == null ? '' : val);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCSV(allRows) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const date    = new Date().toISOString().split('T')[0];
  const outPath = path.join(REPORT_DIR, `referral-${date}.csv`);

  const headers = ['partner_type','city','linkedin_url','google_url','connect_note','followup_dm','email_subject','email_body','why','value'];
  const lines   = allRows.map(r => headers.map(h => escapeCsv(r[h])).join(','));
  fs.writeFileSync(outPath, [headers.join(','), ...lines].join('\n') + '\n');
  return outPath;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

function main() {
  const types  = typeFilter
    ? [typeFilter].filter(t => PARTNER_TYPES[t])
    : Object.keys(PARTNER_TYPES);

  if (types.length === 0) {
    console.error(`Unknown type "${typeFilter}". Valid: ${Object.keys(PARTNER_TYPES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\nReferral Outreach — ${cityArg}`);
  console.log(`Partner types: ${types.map(t => PARTNER_TYPES[t].label).join(', ')}`);
  console.log('─'.repeat(70));

  const allRows = [];

  for (const type of types) {
    const p = PARTNER_TYPES[type];
    const row = {
      partner_type:  p.label,
      city:          cityArg,
      linkedin_url:  linkedinUrl(p.linkedin_kw),
      google_url:    googleUrl(p.google_q),
      connect_note:  p.connect_note(cityShort),
      followup_dm:   p.followup_dm(cityShort),
      email_subject: p.email_subject(cityShort),
      email_body:    p.email_body(cityShort),
      why:           p.why,
      value:         p.value,
    };
    allRows.push(row);

    console.log(`\n${p.label.toUpperCase()}`);
    console.log(`Why: ${p.why}`);
    console.log(`Value: ${p.value}`);
    console.log(`LinkedIn: ${row.linkedin_url}`);
    console.log(`Google:   ${row.google_url}`);
    console.log(`Connect note (LinkedIn):`);
    console.log(`  "${row.connect_note}"`);
    console.log(`Email subject: ${row.email_subject}`);
    console.log('─'.repeat(70));
  }

  const csvPath = writeCSV(allRows);
  console.log(`\nCSV written: ${csvPath}`);

  console.log('\nReferral strategy:');
  console.log('  • Priority order: real estate agents → property managers → inspectors → designers');
  console.log('  • Send 5 LinkedIn connections + 5 emails per partner type per week');
  console.log('  • Goal: 3 active referral partners = 6–12 contractor clients/month passively');
  console.log('  • Offer: $25 cash referral credit for every paying client they send');
  console.log('  • Track referrals in a simple Google Sheet — partner name, client sent, status');
  console.log();
}

main();
