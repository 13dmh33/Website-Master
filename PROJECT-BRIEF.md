# Trevo Advisors — Project Brief

**Date:** June 1, 2026
**Owner:** Dave Hettinger — dave@trevoadvisors.com
**Website:** trevoadvisors.com
**Status:** All 8 scripts live. Dual-channel outreach active. First batch sent 2026-06-01.

---

## What This Is

Trevo Advisors is a solo AI agency that sells websites and voice agents to home service
contractors (plumbers, HVAC techs, electricians, roofers, handymen). The entire outbound
sales pipeline — from finding leads to sending the first message — is automated through
a system of Node.js scripts orchestrated by Claude Code.

**Dave's daily role:**
1. Run Scout locally (Mac) — Outscraper blocked from cloud container
2. Run Pitcher locally (Mac) — Twilio SMS blocked from cloud container
3. Paste Lovable prompts to build mockup sites (~5/day)
4. Record a 60-second Loom walkthrough of each mockup (~5/day)
5. Review morning report email (auto-sent at 7am via cron)
6. Respond to positive replies — Mobile agent handles booking automatically

Everything else is automated.

---

## Brand Identity

| | |
|---|---|
| **Agency** | Trevo Advisors |
| **Domain** | trevoadvisors.com |
| **Email** | dave@trevoadvisors.com |
| **Primary** | #2E5B8A Slate Blue — headers, CTAs, nav |
| **Secondary** | #2E7D5B Growth Green — success, growth signals |
| **Background** | #F8F7F3 Warm Cream — page/card fills |
| **Accent** | #C8720E Amber — use sparingly, 1× per view |

---

## Revenue Model

| Product | Price | Type |
|---|---|---|
| Website build | $400 | One-time |
| Nora voice agent | $399/mo | Recurring standalone |
| Bundle (hosting + Nora) | $350/mo | Recurring |

**Target:** 47 clients/month → ~$18,800/mo recurring at scale

---

## Pipeline Status

| Agent | Script | Status | Notes |
|---|---|---|---|
| Scout | scout.js | ✅ Live | Denver electricians pulled 2026-05-29 |
| Diagnoser | diagnoser.js | ✅ Live | Template-based briefs, no AI copy |
| Checker | checker.js | ✅ Live | Template fast-path, no API cost for templates |
| Builder | builder.js | ✅ Live | Lovable prompts generated |
| Filmer | filmer.js | ✅ Live | Loom instructions generated |
| Pitcher | pitcher.js | ✅ Live | 18 SMS sent 2026-06-01 (Twilio paid) |
| Mobile | mobile.js | ✅ Live | Auto-send, awaiting first real reply |
| Reporter | reporter.js | ✅ Live | Morning email live, cron job pending setup |

---

## The 8 Scripts

### 1. Scout (`scripts/scout.js`)
Pulls contractor leads from Google Maps via the Outscraper API. Filters by review
count (5–300) and rating (4.0+). Scores each lead by "gap" — how much they need a
website. Assigns outreach channel by trade.

- **Output:** `/leads/{city}-{trade}-{date}-run{n}.json`
- **Cost cap:** $10/mo (Outscraper)
- **Initial channel assignment by trade:** plumbers/HVAC → email; electricians/roofers → SMS; handymen → IG DM (overridden by Diagnoser based on actual contact data)
- **⚠️ Must run locally** — Outscraper blocks cloud container IPs.

### 2. Diagnoser (`scripts/diagnoser.js`)
Sends each lead to Claude Haiku with prompt caching. Generates diagnosis, hero angle,
tone, and gap score. Determines channels based on available contact data, then picks
and fills templates from the vault (no AI-written copy).

- **Output:** `/queue/{lead_id}-brief.json`
- **Cost cap:** $5/mo (~$0.001 per brief)
- **Model:** Claude Haiku with ephemeral caching
- **Dual-channel:** if lead has both email + phone, sets `secondary_channel: 'sms'` and fills a second SMS template

### 3. Checker (`scripts/checker.js`)
Quality-gates every cold message. Template-based messages skip straight through
(checks only for unfilled placeholders). AI-generated messages run 5 local evals
with optional Claude rewrite (max 2 attempts).

- **Cost cap:** $3/mo (rewrites only — templates cost $0)

### 4. Builder (`scripts/builder.js`)
Generates a filled-in Lovable.dev prompt for the top 5 priority leads.
Owner pastes each prompt into lovable.dev, copies the deploy URL, submits it.

- **Daily limit:** 5 mockups / No API cost

### 5. Filmer (`scripts/filmer.js`)
Optionally captures a mobile screenshot via ScreenshotOne, then writes Loom recording
instructions. Owner records a 60-second walkthrough and submits the URL.

- **Daily limit:** 5 videos / No API cost (ScreenshotOne optional)

### 6. Pitcher (`scripts/pitcher.js`)
Sends the approved cold message via the right channel(s). Only sends if
`checker_approved = true`. Supports `--dry-run` to preview first.

- **Email:** Zoho SMTP — dave@trevoadvisors.com (120–300s stagger)
- **SMS:** Twilio (paid) — +17209027555 (20–60s stagger)
- **IG DM / LinkedIn:** Manual draft written to `/messages/`
- **Dual-channel:** email sent first; SMS sent automatically on next run after `sms_followup_delay_hours` (default 4h)
- **Per-channel tracking:** `messages/{id}-sent.json` records `email_sent_at` and `sms_sent_at` separately
- **Daily limit:** 30 messages
- **⚠️ Must run locally** — Twilio API blocked from container.

### 7. Mobile (`scripts/mobile.js`)
Handles positive replies automatically. Scans `/messages/` for `status: "positive"`,
drafts a booking reply with 4 time slots spread across the next 2 weeks
(Mon/Wed/Thu preferred, 10am/2pm/4pm rotation), and sends immediately.
Also runs daily Nora upsell check (7 days after each closed deal).

- **Fully automatic** — no owner input required

### 8. Reporter (`scripts/reporter.js`)
Sends a morning email summary to Dave. Shows pipeline counts, SMS/email stats,
template reply rates, and day/month costs across all services.

- **Run:** `node scripts/reporter.js` (print + email) or `--print` for preview only
- **Cron:** `0 7 * * * cd ~/Website-Master && /path/to/node scripts/reporter.js`
- **Email to:** REPORT_TO_EMAIL in .env.local

---

## Template Vault

10 pre-approved templates in `config/templates.json` — 5 SMS (s1–s5) + 5 email (e1–e5).
Diagnoser picks and fills the right template for each lead. A/B rotation via
epsilon-greedy algorithm (20% explore / 80% exploit) learns which template converts best.

Reply tracking: `config/template-stats.json`

---

## Daily Workflow

```bash
# ── ON LOCAL MAC ───────────────────────────────────────────────
node scripts/scout.js --city "Denver, CO" --trade plumber --force
git add leads/ state.json config/cost-log.json
git commit -m "Scout: Denver plumbers" && git push origin claude/kind-hypatia-3YzM0

# ── IN CLAUDE CODE CONTAINER ───────────────────────────────────
node scripts/diagnoser.js --force
node scripts/checker.js --force
node scripts/builder.js --force       # generates Lovable prompts
node scripts/filmer.js --force        # writes Loom instructions

# ── ON LOCAL MAC (after git pull) ─────────────────────────────
git pull origin claude/kind-hypatia-3YzM0
node scripts/pitcher.js --dry-run --force   # preview
node scripts/pitcher.js --force             # send

# ── EACH MORNING ON MAC ───────────────────────────────────────
node scripts/reporter.js              # morning report email

# ── WHEN REPLY COMES IN ───────────────────────────────────────
# Set "status": "positive" in messages/{lead_id}-sent.json, then:
node scripts/mobile.js                # auto-sends booking + Nora upsell
```

---

## Lead State Machine

```
scouted → diagnosed → checked → sent → [positive reply] → call_booked → deal_closed → nora_pitch_due
```

---

## Cost Tracking

All costs logged to `config/cost-log.json` (append-only, tracked in git).
Morning report aggregates by day and month.

| Service | Rate | Cap |
|---|---|---|
| Anthropic (Diagnoser) | ~$0.001/brief | $5/mo |
| Anthropic (Checker rewrites) | ~$0.0003/rewrite | $3/mo |
| Outscraper (Scout) | ~$0.001/lead | $10/mo |
| Twilio (SMS) | $0.0079/msg | none |
| Zoho SMTP (email) | flat subscription | n/a |

**Actual spend 2026-06 MTD:** $0.14 (18 SMS, first batch)

---

## Infrastructure Costs at Scale (47 clients/month)

| Service | Monthly Cost |
|---|---|
| Outscraper (Scout) | ~$2/mo |
| Anthropic API (Diagnoser + Checker) | ~$16/mo |
| Zoho Mail (email) | flat subscription |
| Twilio (SMS) | ~$5–10/mo |
| **Total infrastructure** | **~$25–30/mo** |

At $400/site × 47 = $18,800/mo revenue, infrastructure is <0.2% of revenue.

---

## Known Gaps / Next Steps

| Item | Priority | Notes |
|---|---|---|
| GitHub PAT on Mac | High | Can't push to git from Mac without PAT — set up at github.com/settings/tokens |
| Inbound reply detection | High | Must manually set `"status": "positive"` in messages JSON. Twilio webhook would automate this. |
| Cron job for Reporter | Medium | Add 7am cron on Mac: `crontab -e` |
| Email deliverability (SPF/DKIM/DMARC) | ✅ Done | SPF + DKIM + DMARC set in OpenSRS DNS for trevoadvisors.com (2026-06-01) |
| D&J Enterprises SMS retry | Low | 1 failed send from first batch — retry with `node scripts/pitcher.js --force` |
| Scout must run locally | Info | Cloud container IP blocked by Outscraper |
| Pitcher must run locally | Info | Twilio blocked from container |
| Reporter must run locally | Info | Zoho SMTP blocked from container |
| `years_on_maps` filter | Low | Outscraper doesn't return this field. Filter unenforced. |
| State management at scale | Low | state.json flat file fine until ~1,000 leads, then consider SQLite |

---

## Repo Structure

```
/agents/         — System prompts for all 7 agents
/config/         — Budget caps, counters, templates, cost log
  templates.json       — 5 SMS + 5 email pre-approved templates
  template-stats.json  — A/B reply-rate tracking per template
  cost-log.json        — Append-only cost events (Anthropic/Twilio/Outscraper)
  pitcher-config.json  — Send counts + stagger settings
  diagnoser-config.json
  checker-config.json
  scout-config.json
/leads/          — Raw lead files from Scout
/queue/          — Brief files from Diagnoser (tracked in git)
/mockups/        — Lovable URLs, screenshots, Loom links
/messages/       — Outreach records from Pitcher (gitignored)
/logs/           — Daily append-only logs
/scripts/        — All 8 Node.js scripts
  scout.js
  diagnoser.js
  checker.js
  pitcher.js
  builder.js
  filmer.js
  mobile.js
  reporter.js
  cost-tracker.js  — Shared cost logging module
  template-picker.js — A/B template selection module
  logger.js          — Shared log writer
state.json       — Shared lead state
run-daily.sh     — Full pipeline runner
.env.local       — API keys (gitignored)
.env.local.example — Key template
CLAUDE.md        — Orchestrator config for Claude Code
PROJECT-BRIEF.md — This file
README.md        — Quick start
```

---

*Last updated: 2026-06-01 — First real SMS send complete (18 Denver electricians). Reporter live. All 8 scripts operational.*
