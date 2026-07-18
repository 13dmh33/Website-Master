# Trevo Advisors — AI Outreach Pipeline

Solo AI agency system for selling websites + Nora voice agent bundles to home service contractors.

**Owner:** Dave Hettinger — dave@trevoadvisors.com
**Branch:** `main` (active development)

---

## Revenue Model

- Website build: $150 one-time + $65/mo hosting
- Website + Nora bundle: $200 build + $65/mo
- Target: 47 clients/mo = ~$7K/mo recurring

---

## Quick Start

```bash
npm install
cp .env.local.example .env.local   # fill in API keys
```

See daily workflow below.

---

## Project Status

### Done ✅
- [x] Full folder structure + state machine
- [x] `scripts/scout.js` — Outscraper API, $10/mo cap *(run on Mac)*
- [x] `scripts/diagnoser.js` — Claude Haiku, prompt caching, $5/mo cap, template-based briefs
- [x] `scripts/checker.js` — 5 evals + Claude rewrite loop, template fast-path, $3/mo cap
- [x] `scripts/pitcher.js` — Zoho SMTP (email) + Twilio SMS, staggered sends, --dry-run *(run on Mac)*
- [x] `scripts/builder.js` — Lovable prompt generator, 5/day
- [x] `scripts/filmer.js` — Loom instructions + ScreenshotOne, 5/day
- [x] `scripts/mobile.js` — auto-send booking reply, 4 slots/2 weeks, Nora upsell, /start link
- [x] `scripts/reporter.js` — morning email report (pipeline, costs, template stats) *(run on Mac)*
- [x] `scripts/cost-tracker.js` — central cost log across all agents → `config/cost-log.json`
- [x] `scripts/template-picker.js` — 6 SMS + 5 email templates, epsilon-greedy A/B rotation
- [x] `scripts/reply-classifier.js` — keyword intent classifier, zero API cost
- [x] `scripts/dashboard.js` — terminal pipeline view with color-coded status
- [x] `scripts/webhook.js` — Twilio inbound SMS webhook + HMAC-SHA1 validation *(run on Mac)*
- [x] `scripts/poller.js` — IMAP email reply poller via imapflow *(run on Mac)*
- [x] `config/templates.json` — pre-approved template vault (s1–s6, e1–e5)
- [x] `config/template-stats.json` — reply rate tracking per template
- [x] **First real send** — 18/19 Denver electricians SMS sent 2026-06-01 via Twilio
- [x] **First email batch** — 15 Denver plumbers sent via Zoho SMTP 2026-06-01
- [x] GitHub PAT on Mac — push without password prompts
- [x] Cron job for Reporter — runs at 7am daily on Mac

### Website funnel ✅ Live at trevoadvisors.com
- [x] `website/start/` — /start funnel page (the link texted to positive replies)
- [x] `website/demo/` — 3 demo sites: plumber, electrician, HVAC
- [x] `website/proposal/` — sales proposal page with trade-specific demo link
- [x] `website/intake/` — 4-step client intake form (Formspree — ID: xbdbneej)
- [x] `website/checkout/` — Stripe checkout page (Payment Links pending EIN propagation)
- [x] `website/thankyou/` — post-payment confirmation + next steps
- [x] Deployed to Netlify, DNS updated in OpenSRS, netlify.toml redirect / → /start/
- [x] `webhook.js` — timingSafeEqual RangeError fixed
- [x] `poller.js` — isAutoReply() null crash fixed

### Blocked — waiting on external
- [ ] **Stripe Payment Links** ($150/$200) — EIN too new; IRS verification takes ~1-2 weeks
- [ ] **A2P Campaign** (Twilio 10DLC) — Brand pending approval (1-3 business days); 30 Denver/Englewood sends blocked

### Mac setup (do when A2P approved)
- [ ] Add `SITE_START_URL=https://trevoadvisors.com/start/` to `.env.local`
- [ ] `npm install imapflow` (for poller.js)
- [ ] `node scripts/webhook.js` + ngrok + paste URL in Twilio console

### Bug fixes (container)
- [ ] `mobile.js`: change `call_booked` status to `booking_sent` on send (call not booked until they reply)
- [ ] `drip.js`: fix `[trade]`/`[City]` token substitution in d1c-sms template

---

## Daily Workflow

### Step 1 — Scout (on Mac)
```bash
node scripts/scout.js --city "Denver, CO" --trade electrician --force
git add leads/ state.json config/cost-log.json
git commit -m "Scout: Denver electricians" && git push origin main
```

### Step 2 — Diagnose + Check (in container)
```bash
node scripts/diagnoser.js --force
node scripts/checker.js --force
```

### Step 3 — Build + Film (in container, manual steps)
```bash
node scripts/builder.js --force      # paste prompts into lovable.dev
node scripts/filmer.js --force       # record Loom walkthrough
```

### Step 4 — Send (on Mac)
```bash
git pull origin main
node scripts/pitcher.js --dry-run --force   # preview
node scripts/pitcher.js --force             # send
git add state.json config/ && git commit -m "Pitcher run" && git push origin main
```

### Step 5 — Morning Report (on Mac, or via cron)
```bash
node scripts/reporter.js              # sends to REPORT_TO_EMAIL
node scripts/reporter.js --print      # preview only
```

### Step 5 — Reply Detection (on Mac)
```bash
# Option A — SMS webhook (recommended)
node scripts/webhook.js               # start server; expose with ngrok
# Option B — manual IMAP poll
node scripts/poller.js                # checks Zoho inbox for email replies

# When a positive reply is detected:
node scripts/mobile.js                # auto-sends booking reply + /start link + Nora upsell
```

### Pipeline Dashboard (any machine)
```bash
node scripts/dashboard.js             # full pipeline view
node scripts/dashboard.js --leads     # leads table only
node scripts/dashboard.js --drip      # drip queue only
```

Supported trades: `plumber`, `hvac`, `electrician`, `roofer`, `handyman`

---

## What Runs Where

| Script | Runs On | Why |
|---|---|---|
| scout.js | Mac only | Outscraper blocks cloud container IPs |
| pitcher.js | Mac only | Twilio blocked from container |
| reporter.js | Mac only | Zoho SMTP blocked from container |
| diagnoser.js | Container ✓ | Anthropic API only |
| checker.js | Container ✓ | Anthropic API only |
| builder.js | Container ✓ | No external API |
| filmer.js | Container ✓ | No external API |
| mobile.js | Container ✓ | Anthropic API only |
| dashboard.js | Container ✓ | No external API |
| reply-classifier.js | Container ✓ | No external API |
| webhook.js | Mac only | Must be publicly reachable (ngrok) |
| poller.js | Mac only | Zoho IMAP blocked from container |

---

## Cost Controls

| Script | Cap | Config File |
|---|---|---|
| scout.js | $10/mo (Outscraper) | config/scout-config.json |
| diagnoser.js | $5/mo + 30/day (Claude) | config/diagnoser-config.json |
| checker.js | $3/mo + 30/day (Claude rewrites) | config/checker-config.json |
| pitcher.js | 30 sends/day | config/pitcher-config.json |
| builder.js | 5/day | config/builder-config.json |
| filmer.js | 5/day | config/filmer-config.json |

All costs centrally logged → `config/cost-log.json`
Morning report shows MTD totals per service.

---

## Environment Variables

```bash
# Copy .env.local.example → .env.local and fill in:

OUTSCRAPER_API_KEY=       # outscraper.com/profile
ANTHROPIC_API_KEY=        # console.anthropic.com/keys

ZOHO_EMAIL=               # dave@trevoadvisors.com
ZOHO_APP_PASSWORD=        # Zoho app password (not account password)

TWILIO_ACCOUNT_SID=       # console.twilio.com
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=        # +17209027555

REPORT_TO_EMAIL=          # where morning report is emailed
CALCOM_LINK=              # optional — cal.com booking link for Mobile
TWILIO_WEBHOOK_SECRET=    # same as TWILIO_AUTH_TOKEN — HMAC validation in webhook.js
SITE_START_URL=           # https://trevoadvisors.com/start/ — sent in positive reply drafts
```

---

## Repo Structure

```
/agents/              — System prompts for all 7 agents
/config/              — Budget caps, templates, cost log
  templates.json        — 5 SMS + 5 email pre-approved templates
  template-stats.json   — A/B reply-rate tracking
  cost-log.json         — Append-only cost events (tracked in git)
/leads/               — Raw lead files from Scout
/queue/               — Briefs from Diagnoser (tracked in git)
/mockups/             — Lovable URLs + video links
/messages/            — Outreach records from Pitcher (gitignored)
/logs/                — Daily run logs
/scripts/             — All Node.js scripts
  scout.js · diagnoser.js · checker.js · pitcher.js
  builder.js · filmer.js · mobile.js · reporter.js
  drip.js · webhook.js · poller.js · dashboard.js
  reply-classifier.js · cost-tracker.js · template-picker.js · logger.js
/website/             — Client-facing pages (on claude/demo-site branch)
  start/ · demo/ · proposal/ · intake/ · checkout/ · thankyou/
state.json            — Shared lead state (tracked in git)
run-daily.sh          — Full pipeline runner
.env.local            — API keys (gitignored)
.env.local.example    — Key template
CLAUDE.md             — Orchestrator config for Claude Code
PROJECT-BRIEF.md      — Full project brief
```
