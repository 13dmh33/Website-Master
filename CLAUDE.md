# Maps Agency — Orchestrator Config

## Identity
You are the orchestrator of **Trevo Advisors** (trevoadvisors.com), a solo AI agency
selling websites + voice agents to home service contractors (plumbers, HVAC, electricians, roofers).
Owner: Dave — dave@trevoadvisors.com

Brand colors: Navy #0A1228 (background) · Teal #00C8AF (primary accent) · Deep Teal #008870 (logo iris) · White #FFFFFF · Muted #8BA8C4 · Border rgba(255,255,255,0.08)

Your goal: 47 clients/month at $150/site + $65/mo hosting; Nora bundle adds $200 build + $65/mo.

## Build Status (as of 2026-06-04)
- Scout: ✅ scripts/scout.js — Outscraper API, $10/mo cap, auto_run toggle; --multi flag (TRADE_SYNONYMS, place_id dedup); all trades → sms; gap score 3-10; subtypes/lat/lng stored
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel: sets secondary_channel=sms when lead has both email + phone
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap; template fast-path validates both primary + secondary messages
- Personalizer: ✅ scripts/personalizer.js — generates demo_url for every approved email lead; writes to brief JSON; no API cost; --write to save
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS follows after sms_followup_delay_hours=4); per-channel sent tracking in messages/-sent.json; staggered sends; --dry-run; uses demo_url P.S. if set
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit to record URL, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit to record URL, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler, weekday slot suggestions, auto-send, Nora upsell scheduler; sends /start link in booking reply
- Reporter: ✅ scripts/reporter.js — morning email report; shows email vs SMS split, per-service costs, drip stats
- Drip: ✅ scripts/drip.js — 4-step follow-up sequence (d1/d1b/d1c/d2), per-channel, daily limit 20, --dry-run; config/drip-config.json
- Reply Classifier: ✅ scripts/reply-classifier.js — keyword-based intent classifier (positive/question/objection/negative/stop/auto_reply/neutral), zero API cost
- Dashboard: ✅ scripts/dashboard.js — terminal pipeline view, --leads and --drip flags, color-coded by status
- Webhook: ✅ scripts/webhook.js — Twilio inbound SMS server, HMAC-SHA1 validation; **run on Mac**
- Poller: ✅ scripts/poller.js — IMAP email reply poller (imapflow), auto-reply detection; **run on Mac**
- Website/Demo: ✅ website/ — 3 demo sites (plumber/HVAC/electrician), proposal page, intake form, checkout, thank-you, /start funnel; **on claude/demo-site branch (not yet merged)**

## Template Vault
- 6 SMS templates (s1–s6) + 5 email templates (e1–e5) in config/templates.json
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
2. Diagnoser → process all new leads from /leads/ — run in container
3. Checker + Builder → top 5 priority leads only — run in container
4. Personalizer → `node scripts/personalizer.js --write` — generates demo_url for every approved lead — run in container
5. Filmer → mockups from Builder — run in container
6. Pitcher → approved messages only — **run on Mac** (Twilio blocked from container)
7. Mobile → monitor /messages/ for positive replies — run in container
8. Drip → follow-up non-responders — **run on Mac** (Twilio + Zoho SMTP blocked from container)
9. Reporter → `node scripts/reporter.js` on Mac each morning (or cron at 7am)

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

## Twilio A2P 10DLC Status
- Brand registration submitted: 2026-06-03
- Bundle SID: BUb725ec9662f0dc3da58ed24117df8684
- Status: Resubmitted 2026-06-03 under "David M Hettinger" (initial rejection: name didn't match EIN)
- EIN on file locally (not in repo) — obtained 2026-06-03
- Legal name for all Twilio/IRS submissions: David M Hettinger (DBA: Trevo Advisors)
- Once approved: create Campaign (use case: Mixed) → link +1 720 number to Sender Pool
- Until approved: SMS sends will hit error 30034 and be blocked by carriers

## Mac Action Items (as of 2026-06-04)

### Must do on Mac
1. Create 2 Stripe Payment Links: $150 (website-only) + $200 (website+Nora)
   → Paste into `website/checkout/index.html` replacing `YOUR_WEBSITE_LINK_ID` and `YOUR_NORA_LINK_ID`
2. Create Formspree form at formspree.io
   → Paste form ID into `website/intake/index.html` replacing `YOUR_FORM_ID`
3. Verify Netlify auto-deployed `website/` to trevoadvisors.com (check /start/, /for/, /demos/)
4. Run `node scripts/personalizer.js --write` (after /for/ confirmed live on prod)
5. Check Twilio A2P 10DLC status (Bundle SID: BUb725ec9662f0dc3da58ed24117df8684)
6. Run `node scripts/pitcher.js --force` when A2P approved (5 leads ready)
7. Start `node scripts/webhook.js` + ngrok → register URL in Twilio console
8. Add `SITE_START_URL=https://trevoadvisors.com/start/` + `CALCOM_LINK` to `.env.local`
9. `npm install imapflow` for poller.js
10. Nora-Agent push: `cd ~/Nora-Agent && git push origin main`

### Remaining Polish (container OK)
- Intake form step 3: make optional fields visually obvious
