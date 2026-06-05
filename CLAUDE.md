# Maps Agency — Orchestrator Config

## Identity
You are the orchestrator of **Trevo Advisors** (trevoadvisors.com), a solo AI agency
selling websites + voice agents to home service contractors (plumbers, HVAC, electricians, roofers).
Owner: Dave — dave@trevoadvisors.com

Brand colors: Navy #0A1228 (background) · Teal #00C8AF (primary accent) · Deep Teal #008870 (logo iris) · White #FFFFFF · Muted #8BA8C4 · Border rgba(255,255,255,0.08)

Your goal: 47 clients/month at $150/site + $65/mo hosting; AI bundles (Nora/Atlas/Argus) add $200 build + $65/mo. Three AI products, one price point.

**Trade focus: Plumbing (40%) · Electrical (35%) · Handyman (25%) · Roofing (secondary)**
**HVAC is excluded** — owner works for an HVAC manufacturer (conflict of interest). Never scout, pitch, or generate content targeting HVAC contractors.

## Build Status (as of 2026-06-05 — updated session 3, final)
- Scout v2: ✅ scripts/scout.js — --budget/--target/--min-score/--dry-run/--csv/--suggest flags; pre-dedup; social-only detection; qualify_rate; ROI estimate; **HVAC blocked**; **on claude/scout-refinement**
- Market Audit: ✅ scripts/market-audit.js — 65 US metros scored (digital_gap×0.35 + density×0.30 + homeownership×0.20 + growth×0.15); --trade/--top/--csv; zero API cost; **on claude/scout-refinement**
- Market Data: ✅ config/market-data.json — 65 metros with demand scores; hvac removed from all trades arrays; top markets: Houston, Las Vegas, Phoenix, Dallas, San Antonio; **on claude/scout-refinement**
- Enricher: ✅ scripts/enricher.js — Apollo.io People Match, 200 credit/mo cap; finds owner email; upgrades sms→email; --dry-run; container
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel routing
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap
- Personalizer: ✅ scripts/personalizer.js — generates demo_url per approved lead; --write to save
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS +4h); --dry-run; uses demo_url P.S.
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler; slot suggestions; Nora upsell; sends /start link
- Reporter: ✅ scripts/reporter.js — morning email report; email/SMS split; per-service costs; drip stats
- Drip: ✅ scripts/drip.js — 4-step follow-up (d1/d1b/d1c/d2), per-channel, daily limit 20
- Reply Classifier: ✅ scripts/reply-classifier.js — keyword intent classifier, zero API cost
- Dashboard: ✅ scripts/dashboard.js — terminal pipeline view, --leads/--drip, color-coded
- Webhook: ✅ scripts/webhook.js — Twilio inbound SMS, HMAC-SHA1; **Mac only**
- Poller: ✅ scripts/poller.js — IMAP email reply poller (imapflow); **Mac only**
- Caller: ✅ scripts/caller.js — cold call sheet, ranked by gap score; --sms mode for iPhone
- GBP Audit: ✅ scripts/gbp-audit.js — per-lead outreach hooks (no-website/low-reviews/etc); CSV
- Warm Lead: ✅ scripts/warm-lead.js — instant follow-up after cold call; text + email + D+2
- LinkedIn: ✅ scripts/linkedin.js — connection request + DM generator; CSV
- Referral: ✅ scripts/referral.js — partner outreach (realtors/inspectors/PMs); LinkedIn + email
- Brief: ✅ scripts/brief.js — daily morning briefing; pipeline stats; prioritized action list
- Website/Demo: ✅ website/ — demos (plumbing/electrical/handyman), proposal, intake, checkout, /start, /atlas, /argus; **on claude/trevo-advisors-review-Sjewy**
- Configurator v2: ✅ website/preview/index.html — 4-step flow, font picker, 6 color presets, 8 toggles, device toggle, AI Enhance (Netlify fn); **on claude/molly-ui-polish**
- Netlify Enhance Fn: ✅ netlify/functions/enhance.js — POST → Claude Haiku → headline/tagline/about/cta/trust_line/services; **on claude/molly-ui-polish**
- Molly: ✅ molly/ — Instagram/LinkedIn content engine; researcher→generator→designer→scheduler→analyst; 20 evergreen posts; Trevo navy/teal; **on claude/molly-ui-polish**
- Molly Source Intelligence: ✅ molly/lib/sources.js + molly/templates/sources.json — 200-source DB; static archetypes for plumbing/electrical/handyman; optional RSS (zero API cost); weekly trade rotation (no HVAC); **on claude/molly-ui-polish**
- Atlas: ✅ website/atlas/index.html — AI lead follow-up product; $200 + $65/mo
- Argus: ✅ website/argus/index.html — AI review responder product; $200 + $65/mo

## Template Vault
- 8 SMS templates (s1–s8) + 7 email templates (e1–e7) in config/templates.json
- s7 = Atlas AI angle; s8 = Argus review hook
- e6 = Atlas pitch; e7 = Argus pitch (requires review_count)
- s6 = catch-all (no data requirements) — always available as fallback
- All SMS templates ≤160 chars (1 segment = $0.0079/msg, not $0.04)
- Templates open with "Hey," — no [First Name] substitution
- Diagnoser picks and fills the best template for each lead (no AI-generated copy)
- Templates with missing required fields are skipped automatically (canFill check)
- A/B rotation: epsilon-greedy (20% explore / 80% exploit), MIN_SENDS=3 bootstrap
- Stats tracked in config/template-stats.json (sent + replies per template)
- scripts/template-picker.js handles selection, fill, and stats recording

## File System
- /leads/       — raw leads from Scout (JSON files per city+date)
- /queue/        — leads ready for processing (briefs from Diagnoser); tracked in git
- /mockups/      — Builder outputs (Lovable URLs + video links)
- /messages/     — Pitcher outreach log (sent messages + reply status); gitignored
- /logs/         — daily run logs
- /config/       — agent config files (budget caps, toggles, templates, cost log)
- /scripts/      — runnable Node.js scripts for each agent

## Sub-Agents
Load prompts from /agents/ folder:
- agents/scout.md
- agents/diagnoser.md
- agents/builder.md
- agents/filmer.md
- agents/checker.md
- agents/pitcher.md
- agents/mobile.md

## Orchestration Rules
- Never assign 2 agents to the same lead simultaneously
- Write lead state to state.json after every step
- Human approval required for: deals over $3,000, reply rate below 12%
- Only Builder gets top 5 priority leads per day — not all leads
- Pitcher sends ONLY after Checker has approved the message
- After website deal closes: flag lead for Nora pitch in 7 days
- Scout runs in manual mode (auto_run: false) during testing — use --force flag
- Scout works for any city and any supported trade — no city is hardcoded as default

## Daily Run Order
Shortcut: `./run-daily.sh` (or `npm run daily`) runs all steps in order with manual-step pauses.

Manual order:
1. Scout → target city + trade (ask human at start of each session) — **run on Mac**
2. Enricher → `node scripts/enricher.js --force` — finds emails for phone-only leads — run in container
3. Diagnoser → process all new leads from /leads/ — run in container
4. Checker + Builder → top 5 priority leads only — run in container
5. Personalizer → `node scripts/personalizer.js --write` — generates demo_url for every approved lead — run in container
6. Filmer → mockups from Builder — run in container
7. Pitcher → approved messages only — **run on Mac** (Twilio blocked from container)
8. Mobile → monitor /messages/ for positive replies — run in container
9. Drip → follow-up non-responders — **run on Mac** (Twilio + Zoho SMTP blocked from container)
10. Reporter → `node scripts/reporter.js` on Mac each morning (or cron at 7am)

## Nora Upsell
- Website deal closes → set nora_pitch_due = closed_date + 7 days in state.json
- Mobile agent sends Nora pitch message on due date
- Bundle price: $65/mo (website hosting + Nora)
- Build fee with Nora included: $200 (vs $150 website-only)

## Cost Controls
- Scout: $10/mo Outscraper cap (config/scout-config.json)
- Diagnoser: $5/mo Anthropic cap (config/diagnoser-config.json)
- Checker: $3/mo Anthropic cap (config/checker-config.json)
- Twilio: ~$0.0079/SMS (no cap — tracked in config/cost-log.json)
- All costs centrally logged in config/cost-log.json via scripts/cost-tracker.js

## Environment Variables Needed
```
OUTSCRAPER_API_KEY=
ANTHROPIC_API_KEY=
ZOHO_EMAIL=              # dave@trevoadvisors.com
ZOHO_APP_PASSWORD=       # Zoho app-specific password (not account password)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=
TWILIO_WEBHOOK_SECRET=   # same as TWILIO_AUTH_TOKEN — used for HMAC validation in webhook.js
REPORT_TO_EMAIL=         # where morning report is emailed (defaults to ZOHO_EMAIL)
APOLLO_API_KEY=          # enricher.js — Apollo.io Basic plan ($49/mo); get at app.apollo.io → Settings → Integrations → API
CONTRACTOR_EMAIL=        # optional — deal/reply notifications
CALCOM_LINK=             # optional — shown in Mobile booking drafts
SITE_START_URL=          # https://trevoadvisors.com/start/ — sent in positive reply drafts
```

## Start Each Session
Ask: "What city and trade should Scout target today?"
Scout works for any US city — no defaults. City and trade are always specified at runtime.

## Important: Runs Locally on Mac
The remote Claude Code container has restricted outbound network access.

**Must run on Mac:**
- Scout (scripts/scout.js) — Outscraper API blocks container IPs
- Pitcher (scripts/pitcher.js) — Twilio SMS API blocked from container
- Drip (scripts/drip.js) — Twilio SMS + Zoho SMTP blocked from container
- Reporter (scripts/reporter.js) — Zoho SMTP blocked from container
- Webhook (scripts/webhook.js) — Twilio inbound webhook server, must be publicly reachable (use ngrok)
- Poller (scripts/poller.js) — Zoho IMAP blocked from container

**Runs fine in container:**
- Diagnoser, Checker, Builder, Filmer, Mobile, Dashboard, Reply Classifier (all use Anthropic API or no external API)

Local workflow after Scout/Pitcher runs on Mac:
1. `git add queue/ state.json config/pitcher-config.json config/cost-log.json`
2. `git commit -m "..."` and `git push origin main`
3. Continue AI steps from container

Note: GitHub PAT is configured on Mac (set 2026-06-01). Push works without password prompts.
Morning reporter cron is set on Mac: runs at 7am daily.

## Lead Filter
Scout filters: 5–300 reviews, rating 4.0+, sorted by gap_score desc.
Max reviews raised to 300 to capture qualifying leads in larger cities.

## Channel Routing (Diagnoser)
- Lead has email + phone → channel: email, secondary_channel: sms (SMS follows 4h later)
- Lead has email only → channel: email
- Lead has phone only → channel: sms (or ig_dm/linkedin per Scout trade assignment)
- Delay configurable: config/pitcher-config.json → sms_followup_delay_hours (default: 4)

## Email Deliverability
✅ SPF + DKIM + DMARC all configured on trevoadvisors.com (OpenSRS DNS, 2026-06-01).
Safe to send cold email at volume. DMARC set to p=none (monitor only) — tighten to p=quarantine after first month.

## Live Run History
- 2026-06-01: First real SMS send — 18/19 Denver electricians sent via Twilio template s1
- 2026-06-01: Phase 1+2 complete — dual-channel routing, per-channel counters, report email/SMS split
- 2026-06-01: Email deliverability complete — SPF + DKIM + DMARC set in OpenSRS DNS
- 2026-06-01: GitHub PAT + cron reporter configured on Mac
- 2026-06-01: leads/*.json now tracked in git — Scout syncs to container automatically
- 2026-06-01: SMS templates trimmed to ≤160 chars (1 seg); s6 catch-all added; Hey [First Name] removed
- 2026-06-01: First email batch — 15 Denver plumbers sent via Zoho SMTP
- 2026-06-01: Drip campaign live — drip.js built (4-step sequence, 8 templates approved and loaded)
- 2026-06-02: reply-classifier.js, dashboard.js, webhook.js, poller.js merged to main
- 2026-06-02: website/ directory built — 3 demos + proposal + intake + checkout + thankyou + /start funnel (on claude/demo-site, pending merge)
- 2026-06-02: mobile.js updated — sends /start URL in positive reply, Zoho SMTP fix confirmed
- 2026-06-02: Branches 1–6 merged to main; claude/website and claude/demo-site held pending review
- 2026-06-02: Global pricing update — $150/$200 build + $65/mo applied across all templates, scripts, website pages, and MD files
- 2026-06-03: 30 Denver/Englewood plumbers sent via SMS (Twilio) — 48 total MTD
- 2026-06-03: Diagnoser channel routing bug fixed — phone-only leads now correctly route to sms instead of email
- 2026-06-03: webhook.js timingSafeEqual RangeError fixed; poller.js null-headers crash fixed
- 2026-06-03: EIN obtained (IRS CP575G) for Trevo Advisors — stored locally, not in repo
- 2026-06-03: Twilio A2P 10DLC Brand registration submitted (Bundle SID: BUb725ec9662f0dc3da58ed24117df8684) — initially rejected (name mismatch), resubmitted under "David M Hettinger" to match EIN
- 2026-06-03: Template/SMS audit — all em/en dashes replaced with hyphens (GSM-7, 1 seg), dead templates replaced, tone routing added
- 2026-06-03: Personalizer built — scripts/personalizer.js generates /for/?b=&t=&c=&r= demo URL per lead; website/for/index.html is the prospect-facing page; pitcher.js uses demo_url P.S. in emails
- 2026-06-04: Scout improved — plumber/hvac switched to sms channel; needsEmail filter removed; gap scoring rewritten (3-10 range); --multi flag + TRADE_SYNONYMS; subtypes/lat/lng stored; effective CPL logged
- 2026-06-04: Demo form guard — submit-disabled alert added to all 5 demos (plumbing/hvac/electrical/handyman/roofing)
- 2026-06-05: Enricher built — scripts/enricher.js hits Apollo People Match API to find owner emails for phone-only leads; upgrades queue briefs sms→email; 200 credit/mo cap
- 2026-06-05: CEO sprint complete — Caller/SMS/LinkedIn/Referral/GBP-Audit/Warm-Lead/Brief tools; Atlas + Argus product pages; /start/ AI suite; 3 Stripe slots (Nora/Atlas/Argus) in checkout; intake→checkout flow fixed; 54 briefs have demo_url; 8 SMS + 7 email templates
- 2026-06-05: Scout v2 — --budget/--target/--min-score/--dry-run/--csv flags; pre-dedup from existing leads; social-only site detection; qualify_rate tracking; ROI estimate; on claude/scout-refinement branch
- 2026-06-05: Configurator v2 — 4-step labeled flow, font picker, 6 color presets, 8 section toggles, device toggle, AI Enhance button (Netlify function → Claude Haiku), all 4 plan cards; on claude/molly-ui-polish
- 2026-06-05: Molly built — Instagram/LinkedIn content engine adapted from Milly; researcher→generator→designer→scheduler→analyst; 20 evergreen posts (carousel/caption/trevo_found/reel); Trevo navy/teal canvas; on claude/molly-ui-polish
- 2026-06-05: Molly source intelligence — molly/lib/sources.js: static archetypes for plumbing/electrical/handyman + optional RSS (zero API cost); molly/templates/sources.json: full 200-source DB; researcher.js rotates trade focus weekly
- 2026-06-05: Market prioritization — config/market-data.json: 65 US metro scores; scripts/market-audit.js: ranked audit table + CSV; scout.js --suggest flag: shows top 5 cities at run time
- 2026-06-05: HVAC excluded — removed from Scout TRADE_SYNONYMS + VALID_TRADES (error on --trade hvac); removed from all 65 market trades arrays; removed from Molly researcher + evergreen generator; trade focus locked to plumbing/electrical/handyman/roofing

## Twilio A2P 10DLC Status
- Brand registration submitted: 2026-06-03
- Bundle SID: BUb725ec9662f0dc3da58ed24117df8684
- Status: Resubmitted 2026-06-03 under "David M Hettinger" (initial rejection: name didn't match EIN)
- EIN on file locally (not in repo) — obtained 2026-06-03
- Legal name for all Twilio/IRS submissions: David M Hettinger (DBA: Trevo Advisors)
- Once approved: create Campaign (use case: Mixed) → link +1 720 number to Sender Pool
- Until approved: SMS sends will hit error 30034 and be blocked by carriers

## Action Items (as of 2026-06-05 — next session)

### Revenue — do on Mac now
1. **Personal SMS** (no Twilio needed): `node scripts/caller.js --sms` → copy-paste to iPhone → 10–15 leads/day
2. **Cold calls**: `node scripts/caller.js` → ranked list with talk tracks + demo URLs → call top 20
3. **GBP hooks**: `node scripts/gbp-audit.js` → per-lead opener lines → use before cold call
4. **LinkedIn**: `node scripts/linkedin.js` → CSV → send 15 connection requests
5. **Referral partners**: `node scripts/referral.js` → 3 realtors/inspectors/PMs = 6–12 passive leads/mo
6. **Next Scout run**: `node scripts/scout.js --suggest plumbing` → pick top market → scrape $0.25

### Setup blockers (Mac)
- [ ] **Twilio A2P**: check status at console.twilio.com (Bundle SID: BUb725ec9662f0dc3da58ed24117df8684) — once approved, create Campaign, link +1 720, run `node scripts/pitcher.js --force`
- [ ] **Stripe**: create 4 payment links ($150 website / $200 Nora / $200 Atlas / $200 Argus) → paste IDs into `website/checkout/index.html`
- [ ] **Formspree**: create form at formspree.io → paste form ID into `website/intake/index.html`
- [ ] **Netlify deploy**: confirm trevoadvisors.com/start/ + /for/ + /atlas/ + /argus/ + /demos/ all live
- [ ] **Personalizer**: after /for/ confirmed live → `node scripts/personalizer.js --write`
- [ ] **Webhook**: `node scripts/webhook.js` + ngrok → register URL in Twilio console
- [ ] **Apollo.io**: sign up ($49/mo) → add `APOLLO_API_KEY=` to `.env.local` → `node scripts/enricher.js --force`
- [ ] **Env vars**: add `SITE_START_URL=https://trevoadvisors.com/start/` + `CALCOM_LINK` to `.env.local`
- [ ] **Poller**: `npm install imapflow` then `node scripts/poller.js`

### Next Claude session — container tasks
- [ ] Merge `claude/trevo-advisors-review-Sjewy` → main (website + demos)
- [ ] Merge `claude/molly-ui-polish` → main (Configurator v2 + Molly + sources)
- [ ] Merge `claude/scout-refinement` → main (Scout v2 + market audit)
- [ ] Add handyman demo site to website/demos/ (plumbing + electrical exist; handyman missing)
- [ ] Molly: run `node scripts/test-pipeline.js` to verify end-to-end after npm install
- [ ] Intake form: make optional fields visually distinct (step 3 polish)

### Molly — first run (Mac, after npm install)
1. `cd molly && npm install`
2. `cp .env.example .env` → add `ANTHROPIC_API_KEY`
3. `node scripts/test-pipeline.js` → verify all green
4. `npm run research && npm run generate && npm run design && npm run schedule`
5. Posts land in `output/queue/` → publish manually to Instagram or add `BUFFER_ACCESS_TOKEN` to auto-schedule
