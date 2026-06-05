# Website-Master — Project Overview

This repo contains three separate product systems. Each has its own subdirectory and CLAUDE.md.

---

## 1. Trevo Advisors — AI agency for home service contractors

**Directory:** root (`/scripts`, `/config`, `/website`, etc.)
**Owner:** Dave — dave@trevoadvisors.com
**Business:** Sell websites + voice agents to plumbers, HVAC, electricians, roofers
**Goal:** 47 clients/month at $150/site + $65/mo hosting; Nora bundle $200 build + $65/mo

### Build Status (as of 2026-06-05)
- Scout: ✅ scripts/scout.js — Outscraper API, $10/mo cap, auto_run toggle
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel routing
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS 4h later); staggered sends; --dry-run
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit to record URL, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit to record URL, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler, weekday slots, Nora upsell, /start link
- Reporter: ✅ scripts/reporter.js — morning email report; email/SMS split, per-service costs
- Drip: ✅ scripts/drip.js — 4-step follow-up (d1/d1b/d1c/d2), per-channel, daily limit 20
- Reply Classifier: ✅ scripts/reply-classifier.js — keyword intent classifier, zero API cost
- Dashboard: ✅ scripts/dashboard.js — terminal pipeline view, color-coded by status
- Webhook: ✅ scripts/webhook.js — Twilio inbound SMS, HMAC-SHA1; **run on Mac**
- Poller: ✅ scripts/poller.js — IMAP email reply poller (imapflow); **run on Mac**
- Website: ✅ website/ — 3 demos + proposal + intake + checkout + /start funnel

### Pending (Mac tasks)
- Create Stripe Payment Links ($150 + $200) → paste into website/checkout/index.html
- Create Formspree form → paste ID into website/intake/index.html
- Merge claude/demo-site → main → deploy to trevoadvisors.com
- npm install imapflow, start webhook.js + ngrok, register in Twilio

### Key rules
- Scout: any US city, any trade — never hardcoded defaults
- Pitcher sends ONLY after Checker approves
- Human approval required: deals over $3,000, reply rate below 12%
- Must run on Mac: Scout, Pitcher, Drip, Reporter, Webhook, Poller (all blocked from container)

---

## 2. Milly — Instagram content engine for Reeve

**Directory:** `/milly`
**Branch:** `claude/milly-content-engine-qZme3`
**See:** `milly/CLAUDE.md` for full detail

Posts 4x/week to @reeve.agency. Feeds the Reeve client acquisition flywheel.
Weekly pipeline: Researcher → Generator → Designer → Scheduler (Mon–Tue cron via GitHub Actions)

**Status:** Fully built and tested. Pending: Buffer access token (classic API token, not OIDC) + Mac scheduler run.

---

## 3. Reeve — Speaker booking DM agent and outreach system

**Directory:** `/reeve`
**Branch:** `claude/milly-content-engine-qZme3` (same branch as Milly for now)
**See:** `reeve/CLAUDE.md` for full scope and roadmap

DM qualification agent live. When speaker DMs "stages" → Reeve runs 3-question qualification → scores fit → routes to Dave or declines. Full outreach pipeline built: conference scout, pitcher, follower, reporter, closer (Phases 2–6).

**Status:** All 6 phases built. Pending: Meta App setup + Railway deploy + Cal.com link.

---

## 4. Strategy — Business intelligence and pricing monitor

**Directory:** `/strategy`
**Branch:** `claude/milly-content-engine-qZme3`
**See:** `strategy/CLAUDE.md` for monitoring cadence and metric thresholds

Zero-API-cost monitoring agent. Reads pipeline JSON files, computes MRR/conversion/churn metrics, flags alerts, produces pricing analysis. Run weekly.

**Scripts:**
- `node strategy/agents/strategist.js --dashboard` — terminal health view (default)
- `node strategy/agents/strategist.js --monitor` — dashboard + save JSON snapshot to strategy/reports/
- `node strategy/agents/strategist.js --pricing` — full pricing model analysis
- `node strategy/agents/strategist.js --alerts` — active alerts only

**Status:** Built. Pricing analysis complete (strategy/reports/pricing-analysis-2026-06-05.md). Run --monitor weekly (Mondays).

---

## Repo branch strategy
- `main` — stable, deployed code
- `claude/milly-content-engine-qZme3` — active Milly + Reeve development
- Merge to main only after Dave reviews

## Active branch summary (claude/milly-content-engine-qZme3)
Everything in /milly, /reeve, and /strategy is on this branch. All commits pushed. Merge to main when ready to go live.
- Scout: ✅ scripts/scout.js — Outscraper API, $10/mo cap, auto_run toggle
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel: sets secondary_channel=sms when lead has both email + phone
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap; template fast-path validates both primary + secondary messages
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS follows after sms_followup_delay_hours=4); per-channel sent tracking in messages/-sent.json; staggered sends; --dry-run
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
4. Filmer → mockups from Builder — run in container
5. Pitcher → approved messages only — **run on Mac** (Twilio blocked from container)
6. Mobile → monitor /messages/ for positive replies — run in container
7. Drip → follow-up non-responders — **run on Mac** (Twilio + Zoho SMTP blocked from container)
8. Reporter → `node scripts/reporter.js` on Mac each morning (or cron at 7am)

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
- 2026-06-05: JSON.parse hardening — all 7 Trevo scripts crash-safe; saveConfig/checkAutoRun gaps fixed
- 2026-06-05: Milly evergreen bank expanded 13→25 posts; SECRETS_SETUP.md added
- 2026-06-05: GitHub Actions workflows moved to .github/workflows/, Buffer env vars corrected
- 2026-06-05: Reeve 4-tier qualifier, scout follow-up flow; Strategy monitor agent built

## Action Items for Dave (2026-06-05)

### On Mac — one-time setup
See `SECRETS_SETUP.md` for full step-by-step guide.

1. **Buffer classic token** — buffer.com/developers → Create App → Generate Access Token → add to `milly/.env`
2. **Buffer profile ID** — `curl https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN` → copy Instagram profile `id` → add to `milly/.env`
3. **GitHub Actions secrets** (7 required) — repo → Settings → Secrets → Actions:
   `ANTHROPIC_API_KEY`, `BUFFER_ACCESS_TOKEN`, `BUFFER_INSTAGRAM_PROFILE_ID`, `SERPAPI_KEY`, `UNSPLASH_ACCESS_KEY`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`
4. **Stripe Payment Links** — dashboard.stripe.com → paste IDs into `website/checkout/index.html`
5. **Formspree form** — formspree.io → paste ID into `website/intake/index.html`
6. **Deploy demo site** — merge `claude/demo-site` → `main` → deploy `website/` to trevoadvisors.com
7. **imapflow + webhook** — `npm install imapflow` → start `webhook.js` + ngrok → register URL in Twilio console
8. **Add to .env.local** — `SITE_START_URL=https://trevoadvisors.com/start/`
9. **Reeve** — Meta App setup + Railway deploy + Cal.com link (see `reeve/CLAUDE.md`)
10. **Merge to main** — review `claude/milly-content-engine-qZme3` → merge when ready to activate GitHub Actions

### Low Priority Polish (container OK)
- `website/demo/hvac.html`: add `<meta name="robots" content="noindex, nofollow">` + emoji favicon
- `website/start/index.html` + `website/thankyou/index.html`: add OG tags
- All demo contact forms: add "This is a demo — submit disabled" alert on form submit
- `website/proposal/index.html`: show all 3 demo links when no `?trade=` param
- Intake form step 3: make optional fields visually obvious

## Completed This Session (2026-06-05)
- JSON.parse hardening: all 7 Trevo scripts now fail cleanly instead of crashing with SyntaxError
- Restored missing `saveConfig()` in drip.js; added missing `checkAutoRun()` in diagnoser.js
- Milly evergreen bank: expanded from 13 → 25 posts (6 weeks of fallback content across all 4 pillars)
- SECRETS_SETUP.md: one-sitting deployment guide for Dave
- Milly GitHub Actions: moved workflows to `.github/workflows/`, fixed Buffer env vars, correct cron times
- Reeve: 4-tier qualifier (high/mid/scout/low), scout follow-up flow, review-leads.js --scout flag
- Strategy: strategist.js zero-API-cost monitor, pricing analysis, CLAUDE.md
- Milly generator: CTA alternation, pricing transparency post, service clarity rotation
