# Website-Master — Project Overview

This repo contains four product systems. Trevo is the main system (root directory). Milly, Reeve, and Strategy are in subdirectories with their own CLAUDE.md files.

---

## Trevo Advisors — AI agency for home service contractors

**Owner:** Dave — dave@trevoadvisors.com

Brand colors: Navy #0A1228 (background) · Teal #00C8AF (primary accent) · Deep Teal #008870 (logo iris) · White #FFFFFF · Muted #8BA8C4 · Border rgba(255,255,255,0.08)

Your goal: 47 clients/month at $150/site + $65/mo hosting; AI bundles (Nora/Atlas/Argus) add $200 build + $65/mo. Three AI products, one price point.

**Trade focus: Plumbing (40%) · Electrical (35%) · Handyman (25%) · Roofing (secondary)**
**HVAC is excluded** — owner works for an HVAC manufacturer (conflict of interest). Never scout, pitch, or generate content targeting HVAC contractors.

## Build Status (as of 2026-06-05 — updated session 3, final)
- Scout v2: ✅ scripts/scout.js — --budget/--target/--min-score/--dry-run/--csv/--suggest flags; pre-dedup; social-only detection; qualify_rate; ROI estimate; **HVAC blocked**; **on claude/scout-refinement**
- Market Audit: ✅ scripts/market-audit.js — 65 US metros scored; --trade/--top/--csv; zero API cost; **on claude/scout-refinement**
- Enricher: ✅ scripts/enricher.js — Apollo.io People Match, 200 credit/mo cap; finds owner email; upgrades sms→email
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
- GBP Audit: ✅ scripts/gbp-audit.js — per-lead outreach hooks; CSV
- Warm Lead: ✅ scripts/warm-lead.js — instant follow-up after cold call; text + email + D+2
- LinkedIn: ✅ scripts/linkedin.js — connection request + DM generator; CSV
- Referral: ✅ scripts/referral.js — partner outreach (realtors/inspectors/PMs); LinkedIn + email
- Brief: ✅ scripts/brief.js — daily morning briefing; pipeline stats; prioritized action list
- Website/Demo: ✅ website/ — demos (plumbing/electrical/handyman), proposal, intake, checkout, /start, /atlas, /argus; **on claude/trevo-advisors-review-Sjewy**
- Configurator v2: ✅ website/preview/index.html — 4-step flow, font picker, 6 color presets, 8 toggles, AI Enhance; **on claude/molly-ui-polish**
- Netlify Enhance Fn: ✅ netlify/functions/enhance.js — POST → Claude Haiku; **on claude/molly-ui-polish**
- Molly: ✅ molly/ — Instagram/LinkedIn content engine for Trevo; **on main (merged)**
- Atlas: ✅ website/atlas/index.html — AI lead follow-up product; $200 + $65/mo
- Argus: ✅ website/argus/index.html — AI review responder product; $200 + $65/mo

---

## Milly — Instagram content engine for Reeve

**Directory:** `/milly`
**See:** `milly/CLAUDE.md` for full detail

Posts 4x/week to @reeve.agency. Feeds the Reeve client acquisition flywheel.
Weekly pipeline: Researcher → Generator → Designer → Scheduler (Mon–Tue cron via GitHub Actions)

**Status:** Fully built. GitHub Actions active on main. Pending: Buffer classic token + Buffer profile ID.

---

## Reeve — Speaker booking DM agent and outreach system

**Directory:** `/reeve`
**See:** `reeve/CLAUDE.md` for full scope and roadmap

DM qualification agent + full outreach pipeline. When speaker DMs "stages" → 3-question qualification → 4-tier scoring → routes to Dave or declines. Phases 2–6: conference scout, pitcher, follower, reporter, closer.

**Status:** All 6 phases built. Pending: Meta App setup + Railway deploy + Cal.com link.

---

## Strategy — Business intelligence and pricing monitor

**Directory:** `/strategy`
**See:** `strategy/CLAUDE.md` for monitoring cadence and metric thresholds

Zero-API-cost monitoring agent. Reads pipeline JSON files, computes MRR/conversion/churn metrics, flags alerts, produces pricing analysis. Run weekly (Mondays).

**Scripts:**
- `node strategy/agents/strategist.js --dashboard` — terminal health view (default)
- `node strategy/agents/strategist.js --monitor` — dashboard + save JSON snapshot to strategy/reports/
- `node strategy/agents/strategist.js --pricing` — full pricing model analysis
- `node strategy/agents/strategist.js --alerts` — active alerts only

---

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
APOLLO_API_KEY=          # enricher.js — Apollo.io Basic plan ($49/mo)
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
- 2026-06-01: SMS templates trimmed to ≤160 chars (1 seg); s6 catch-all added; Hey [First Name] removed
- 2026-06-01: First email batch — 15 Denver plumbers sent via Zoho SMTP
- 2026-06-01: Drip campaign live — drip.js built (4-step sequence, 8 templates approved and loaded)
- 2026-06-02: reply-classifier.js, dashboard.js, webhook.js, poller.js merged to main
- 2026-06-02: website/ directory built — 3 demos + proposal + intake + checkout + thankyou + /start funnel
- 2026-06-02: mobile.js updated — sends /start URL in positive reply, Zoho SMTP fix confirmed
- 2026-06-02: Global pricing update — $150/$200 build + $65/mo
- 2026-06-03: 30 Denver/Englewood plumbers sent via SMS; 48 total MTD
- 2026-06-03: Diagnoser channel routing bug fixed; webhook/poller crash fixes
- 2026-06-03: EIN obtained; Twilio A2P 10DLC Brand registration submitted
- 2026-06-03: Personalizer built — /for/ demo URL per lead; pitcher uses demo_url P.S.
- 2026-06-04: Scout improved — gap scoring, --multi, HVAC excluded
- 2026-06-05: Enricher, CEO sprint, Scout v2, Configurator v2, Molly, Market Audit
- 2026-06-05: HVAC excluded across all systems
- 2026-06-10: Milly/Reeve/Strategy code added to main — GitHub Actions active for Milly pipeline
- 2026-06-19: Aurora, CO scout run — 31 qualifying no-website plumber leads added to main
- 2026-06-19: Live Stripe Payment Links wired for Website-only + Website+Nora in checkout
- 2026-06-22: Has-website lead segment identified (~100+ CO plumbers); has-website pitcher scoped (not built); diagnostic-agent discovery questionnaire sent to design partner
- 2026-06-22: Manual lead-quality cleanup underway (phone validation, DO NOT CALL tagging) in Google Sheets

## Twilio A2P 10DLC Status
- Brand registration submitted: 2026-06-03
- Bundle SID: BUb725ec9662f0dc3da58ed24117df8684
- Status: Resubmitted 2026-06-03 under "David M Hettinger" (initial rejection: name didn't match EIN)
- Legal name for all Twilio/IRS submissions: David M Hettinger (DBA: Trevo Advisors)
- Once approved: create Campaign (use case: Mixed) → link +1 720 number to Sender Pool
- Until approved: SMS sends will hit error 30034 and be blocked by carriers

## Has-Website Segment (new, scoping only — as of 2026-06-22)
- A second lead segment has been identified: contractors who already HAVE a website + email (separate from Scout's no-website-only leads). ~100+ Colorado plumbers collected manually in a Google Sheet tab (Company name/URL/Phone/Email/All Emails).
- Goal: a new email-only pitcher angle — "update/redesign your site" + "save money vs. your current hosting" — instead of the existing "you have no website" framing.
- Status: **scoping only, nothing built.** Sent business partner (website design professional) a discovery prompt covering: conversion-killers checklist, quick-audit workflow, automatable vs. AI-vision-required checks, 2025-2026 design trend signals, realistic hosting/builder cost benchmarks (Wix/Squarespace/WordPress), audit output format (paragraph vs. mini-report), and tone/credibility guardrails.
- "Name your price" for the basic website tier was discussed and explicitly tabled — keep in back pocket, not in current scope.
- Open decisions before build: how rigorous the site diagnosis needs to be (free APIs only vs. AI vision/screenshot pass), whether savings claims are specific $ amounts or generic ranges, human-review gate or auto-send.
- config/templates.json currently has ZERO templates for this angle — all 7 email + 8 SMS templates assume no existing website. New templates (e8+) would be email-only per current direction.

## Lead Quality Cleanup (manual, in progress — as of 2026-06-22)
- User is manually calling through Pueblo/Colorado Springs/Aurora/Denver leads in a Google Sheet, tagging each row: "Phone Good?" (Yes/No) and "Outcome" (VM, Not interested, DO NOT CALL, etc.).
- Dead/disconnected numbers and DO-NOT-CALL flags should eventually map to the `Unsubscribe` field if/when these leads are merged into Trevo's automated `leads/*.json` pipeline — not yet automated, purely manual tracking today.
- No automated phone-validation or lead-decay scoring has been built — explicitly deferred until volume justifies it.

## Checkout — Live Stripe Links (as of 2026-06-19)
- Website-only and Website+Nora Stripe Payment Links are LIVE in `website/checkout/index.html` (`STRIPE_LINK_WEBSITE`, `STRIPE_LINK_NORA`).
- Atlas/Argus checkout UI and routing logic remain in the file intentionally (do not remove) — their Stripe links are still placeholders pending vetting; only 2 of 4 links are real right now.
- Atlas/Argus are scoped as backend agents (would not live as static site pages) — building them is deferred, kept on the roadmap, no infra started.

## Action Items (as of 2026-06-10)

### Revenue — do on Mac now
1. **Personal SMS** (no Twilio needed): `node scripts/caller.js --sms` → copy-paste to iPhone → 10–15 leads/day
2. **Cold calls**: `node scripts/caller.js` → ranked list with talk tracks + demo URLs → call top 20
3. **GBP hooks**: `node scripts/gbp-audit.js` → per-lead opener lines → use before cold call
4. **LinkedIn**: `node scripts/linkedin.js` → CSV → send 15 connection requests
5. **Referral partners**: `node scripts/referral.js` → 3 realtors/inspectors/PMs = 6–12 passive leads/mo
6. **Next Scout run**: `node scripts/scout.js --suggest plumbing` → pick top market → scrape $0.25

### Setup blockers (Mac)
- [ ] **Twilio A2P**: check status at console.twilio.com — once approved, create Campaign, link +1 720, run pitcher
- [ ] **Stripe**: create 4 payment links ($150 website / $200 Nora / $200 Atlas / $200 Argus) → paste IDs into `website/checkout/index.html`
- [ ] **Formspree**: create form at formspree.io → paste form ID into `website/intake/index.html`
- [ ] **Netlify deploy**: confirm trevoadvisors.com/start/ + /for/ + /atlas/ + /argus/ + /demos/ all live
- [ ] **Webhook**: `node scripts/webhook.js` + ngrok → register URL in Twilio console
- [ ] **Apollo.io**: sign up ($49/mo) → add `APOLLO_API_KEY=` to `.env.local`
- [ ] **Buffer classic token** → add to `milly/.env` (for Milly auto-posting to @reeve.agency)
- [ ] **Reeve**: Meta App setup + Railway deploy + Cal.com link (see `reeve/CLAUDE.md`)

### Next Claude session — container tasks
- [ ] Merge `claude/trevo-advisors-review-Sjewy` → main (website + demos)
- [ ] Merge `claude/molly-ui-polish` → main (Configurator v2 + Molly sources)
- [ ] Merge `claude/scout-refinement` → main (Scout v2 + market audit)
- [ ] Add handyman demo site to website/demos/ (plumbing + electrical exist; handyman missing)

### Milly — first run (Mac, after Buffer token setup)
1. Add `BUFFER_ACCESS_TOKEN` + `BUFFER_INSTAGRAM_PROFILE_ID` to `milly/.env`
2. GitHub Actions cron is active on main — Mon 6am MT pipeline, Sun 10pm analytics
3. Manual test: `cd milly && node scripts/test-pipeline.js`
