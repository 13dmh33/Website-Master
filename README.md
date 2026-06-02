# Trevo Advisors — AI Outreach Pipeline

Solo AI agency system for selling websites + Nora voice agent bundles to home service contractors.

**Owner:** Dave Hettinger — dave@trevoadvisors.com
**Branch:** `claude/kind-hypatia-3YzM0`

---

## Revenue Model

- Website: $400 one-time
- Nora voice agent: $399/mo standalone / $350/mo bundle
- Target: 47 clients/mo = ~$18K/mo recurring

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
- [x] `scripts/mobile.js` — auto-send booking reply, 4 slots/2 weeks, Nora upsell
- [x] `scripts/reporter.js` — morning email report (pipeline, costs, template stats) *(run on Mac)*
- [x] `scripts/cost-tracker.js` — central cost log across all agents → `config/cost-log.json`
- [x] `scripts/template-picker.js` — 5 SMS + 5 email templates, epsilon-greedy A/B rotation
- [x] `config/templates.json` — pre-approved template vault (s1–s5, e1–e5)
- [x] `config/template-stats.json` — reply rate tracking per template
- [x] **First real send** — 18/19 Denver electricians SMS sent 2026-06-01 via Twilio

### Pending
- [ ] GitHub PAT on Mac — needed for `git push` from terminal
- [ ] Cron job for Reporter — `crontab -e`, run at 7am daily
- [ ] Twilio inbound webhook — auto-detect replies instead of manual status update
- [ ] Email leads — run Scout for plumbers/HVAC to get Zoho SMTP sends flowing

---

## Daily Workflow

### Step 1 — Scout (on Mac)
```bash
node scripts/scout.js --city "Denver, CO" --trade electrician --force
git add leads/ state.json config/cost-log.json
git commit -m "Scout: Denver electricians" && git push origin claude/kind-hypatia-3YzM0
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
git pull origin claude/kind-hypatia-3YzM0
node scripts/pitcher.js --dry-run --force   # preview
node scripts/pitcher.js --force             # send
git add state.json config/ && git commit -m "Pitcher run" && git push origin claude/kind-hypatia-3YzM0
```

### Step 5 — Morning Report (on Mac, or via cron)
```bash
node scripts/reporter.js              # sends to REPORT_TO_EMAIL
node scripts/reporter.js --print      # preview only
```

### When a Reply Comes In
```bash
# 1. Set "status": "positive" in messages/{lead_id}-sent.json
# 2. Run:
node scripts/mobile.js                # auto-sends booking reply + Nora upsell
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
  cost-tracker.js · template-picker.js · logger.js
state.json            — Shared lead state (tracked in git)
run-daily.sh          — Full pipeline runner
.env.local            — API keys (gitignored)
.env.local.example    — Key template
CLAUDE.md             — Orchestrator config for Claude Code
PROJECT-BRIEF.md      — Full project brief
```
