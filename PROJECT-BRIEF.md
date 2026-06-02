# Trevo Advisors — Project Brief

**Date:** June 2, 2026
**Owner:** Dave Hettinger — dave@trevoadvisors.com
**Website:** trevoadvisors.com
**Status:** All 14 scripts live. Dual-channel outreach active. Full website funnel built — Stripe/Formspree config + deploy pending.

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
| Website build | $150 | One-time |
| Hosting | $65/mo | Recurring |
| Website + Nora build | $200 | One-time |
| Bundle (hosting + Nora) | $65/mo | Recurring |

**Target:** 47 clients/month → ~$7,050/mo recurring at scale

---

## Pipeline Status

| Agent | Script | Status | Notes |
|---|---|---|---|
| Scout | scout.js | ✅ Live | Denver electricians pulled 2026-05-29 |
| Diagnoser | diagnoser.js | ✅ Live | Template-based briefs, no AI copy |
| Checker | checker.js | ✅ Live | Template fast-path, no API cost for templates |
| Builder | builder.js | ✅ Live | Lovable prompts generated |
| Filmer | filmer.js | ✅ Live | Loom instructions generated |
| Pitcher | pitcher.js | ✅ Live | 18 SMS + 15 emails sent |
| Mobile | mobile.js | ✅ Live | Auto-send, sends /start link, Nora upsell |
| Reporter | reporter.js | ✅ Live | Morning email + cron set on Mac (7am) |
| Drip | drip.js | ✅ Live | 4-step sequence (d1/d1b/d1c/d2), 8 templates |
| Reply Classifier | reply-classifier.js | ✅ Live | Keyword intent classifier, zero API cost |
| Dashboard | dashboard.js | ✅ Live | Terminal pipeline view, color-coded status |
| Webhook | webhook.js | ✅ Live | Twilio inbound SMS, HMAC-SHA1 — needs Mac + ngrok |
| Poller | poller.js | ✅ Live | IMAP email reply poller — needs Mac + imapflow |
| Website | website/ | ✅ Built | 6 pages done on claude/demo-site — Stripe/Formspree + deploy pending |

---

## The 14 Scripts

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

### 9. Drip (`scripts/drip.js`)
4-step follow-up sequence for non-responders. Runs daily, sends up to 20 messages
per channel per day. Skips leads already on positive/call_booked status.

- **Steps:** d1 (day 4), d1b (day 8), d1c (day 12), d2 (day 19) — dead after day 26
- **Config:** `config/drip-config.json`
- **⚠️ Must run locally** — Twilio + Zoho SMTP blocked from container.

### 10. Reply Classifier (`scripts/reply-classifier.js`)
Keyword-based intent classifier. Reads new replies and tags them as:
positive / question / objection / negative / stop / auto_reply / neutral.
Zero API cost. Called by webhook.js and poller.js.

### 11. Dashboard (`scripts/dashboard.js`)
Terminal pipeline view. Shows all leads color-coded by status (queue / sent / hot /
deal_closed). Flags leads stuck in any stage. Use `--leads` or `--drip` flags.

### 12. Webhook (`scripts/webhook.js`)
HTTP server that receives Twilio inbound SMS webhooks. Validates HMAC-SHA1 signature,
classifies reply intent via reply-classifier.js, updates messages JSON.

- **⚠️ Must run locally** on Mac + exposed via ngrok. URL registered in Twilio console.

### 13. Poller (`scripts/poller.js`)
IMAP poller for Zoho inbox. Reads unread emails, detects auto-replies,
classifies intent, updates messages JSON. Runs on demand or cron.

- **⚠️ Must run locally** — Zoho IMAP blocked from container.
- **Requires:** `npm install imapflow` on Mac.

### 14. Website (`website/`)
Full client-facing funnel. Lives on claude/demo-site branch (not yet merged to main).

- `/start/` — hero landing page texted to positive replies
- `/demo/` — 3 live demo sites (plumber, electrician, HVAC)
- `/proposal/` — personalized sales proposal with trade-specific demo
- `/intake/` — 4-step client intake form (Formspree)
- `/checkout/` — Stripe Payment Link checkout ($150 website / $200 + Nora)
- `/thankyou/` — post-payment confirmation + next steps

---

## Template Vault

11 pre-approved templates in `config/templates.json` — 6 SMS (s1–s6) + 5 email (e1–e5).
- All SMS templates ≤160 chars (1 Twilio segment = $0.0079/msg)
- s6 = catch-all with no data requirements — always available as fallback
- Templates with missing required fields skipped automatically
- All templates open with "Hey," — no first name substitution
- A/B rotation via epsilon-greedy algorithm (20% explore / 80% exploit)

Reply tracking: `config/template-stats.json`

---

## Daily Workflow

```bash
# ── ON LOCAL MAC ───────────────────────────────────────────────
node scripts/scout.js --city "Denver, CO" --trade plumber --force
git add leads/ state.json config/cost-log.json
git commit -m "Scout: Denver plumbers" && git push origin main

# ── IN CLAUDE CODE CONTAINER ───────────────────────────────────
node scripts/diagnoser.js --force
node scripts/checker.js --force
node scripts/builder.js --force       # generates Lovable prompts
node scripts/filmer.js --force        # writes Loom instructions

# ── ON LOCAL MAC (after git pull) ─────────────────────────────
git pull origin main
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

At $150/site × 47 = $7,050/mo revenue, infrastructure is <0.5% of revenue.

---

## Known Gaps / Next Steps

### Tomorrow — Mac Setup (do these before next outreach run)

| Item | Priority | Notes |
|---|---|---|
| Create 2 Stripe Payment Links | 🔴 High | $150 (website-only) + $200 (website+Nora) → paste into `website/checkout/index.html` |
| Create Formspree form | 🔴 High | Paste form ID into `website/intake/index.html` replacing `YOUR_FORM_ID` |
| Merge claude/demo-site → main | 🔴 High | All 6 website pages built and priced; ready to merge |
| Deploy website/ to trevoadvisors.com | 🔴 High | After merge — /start, /demo, /proposal, /intake, /checkout, /thankyou |
| `npm install imapflow` on Mac | 🟡 Medium | Required for poller.js |
| Start webhook.js + ngrok | 🟡 Medium | `node scripts/webhook.js` + expose via ngrok + register URL in Twilio console |
| Add `SITE_START_URL` to .env.local | 🟡 Medium | `SITE_START_URL=https://trevoadvisors.com/start/` |

### Bug Fixes (container — can do any session)

| Item | Priority | Notes |
|---|---|---|
| webhook.js: timingSafeEqual RangeError | 🟡 Medium | Add `if (expected.length !== signature.length) return false;` guard before compare |
| poller.js: isAutoReply() null crash | 🟡 Medium | Add `if (!headers) return false;` guard at top of function |
| mobile.js: status set too early | 🟡 Medium | Sets `call_booked` on send — should set `booking_sent` instead |
| d1c-sms: unfilled `[trade]`/`[City]` tokens | 🟡 Medium | Fix token substitution in drip.js for d1c SMS template |
| demo/hvac.html: missing noindex meta | 🟢 Low | Add `<meta name="robots" content="noindex, nofollow">` + emoji favicon |
| start/index.html: missing OG tags | 🟢 Low | Add Open Graph meta for social sharing |
| thankyou/index.html: missing OG tags | 🟢 Low | Add Open Graph meta |
| Demo contact forms: no "demo" alert | 🟢 Low | Add "This is a demo — form submit disabled" alert on submit |
| proposal/index.html: no-trade fallback | 🟢 Low | Show all 3 demo links when no `?trade=` param instead of defaulting to plumber |
| Intake form step 3 UX | 🟢 Low | Make "optional" fields visually obvious (muted label + italic) |

### Already Done ✅

| Item | Completed |
|---|---|
| GitHub PAT on Mac | 2026-06-01 |
| Cron job for Reporter (7am daily) | 2026-06-01 |
| Email deliverability (SPF/DKIM/DMARC) | 2026-06-01 |
| Dual-channel outreach (email + SMS) | 2026-06-01 |
| Drip campaign (4-step, 8 templates) | 2026-06-01 |
| reply-classifier, dashboard, webhook, poller | 2026-06-02 |
| Pricing update across all files ($150/$200/$65) | 2026-06-02 |
| Website funnel built (6 pages) | 2026-06-02 |
| Branches 1–6 merged to main | 2026-06-02 |
| EIN obtained (IRS CP575G) for Trevo Advisors | 2026-06-03 |
| A2P 10DLC Brand registration submitted | 2026-06-03 |
| Diagnoser phone-only channel routing bug fixed | 2026-06-03 |
| 30 SMS sent — Denver + Englewood plumbers (48 MTD) | 2026-06-03 |

### Twilio A2P 10DLC Status

| Field | Value |
|---|---|
| Brand status | Submitted — pending approval (1–3 business days) |
| Bundle SID | BUb725ec9662f0dc3da58ed24117df8684 |
| EIN | On file locally — not stored in repo |
| Next step | After Brand approved: create Campaign (Mixed use case) → link +1 720 number to Sender Pool |
| Sends blocked until | Campaign approved and number added to Sender Pool |

---

## Repo Structure

```
/agents/         — System prompts for all 7 agents
/config/         — Budget caps, counters, templates, cost log
  templates.json       — 6 SMS + 5 email pre-approved templates (+ 8 drip)
  template-stats.json  — A/B reply-rate tracking per template
  cost-log.json        — Append-only cost events (Anthropic/Twilio/Outscraper)
  drip-config.json     — Drip sequence delays + daily limits
  pitcher-config.json  — Send counts + stagger settings
  diagnoser-config.json
  checker-config.json
  scout-config.json
/leads/          — Raw lead files from Scout
/queue/          — Brief files from Diagnoser (tracked in git)
/mockups/        — Lovable URLs, screenshots, Loom links
/messages/       — Outreach records from Pitcher (gitignored)
/logs/           — Daily append-only logs
/scripts/        — All 14 Node.js scripts
  scout.js · diagnoser.js · checker.js · pitcher.js
  builder.js · filmer.js · mobile.js · reporter.js
  drip.js · webhook.js · poller.js · dashboard.js
  reply-classifier.js · cost-tracker.js · template-picker.js · logger.js
/website/        — Client-facing funnel (on claude/demo-site, pending merge)
  start/           — Hero landing page (/start URL sent in positive replies)
  demo/            — 3 live demo sites (plumber, electrician, HVAC)
  proposal/        — Personalized sales proposal page
  intake/          — 4-step client intake form (Formspree)
  checkout/        — Stripe Payment Link checkout
  thankyou/        — Post-payment confirmation + next steps
state.json       — Shared lead state
run-daily.sh     — Full pipeline runner
.env.local       — API keys (gitignored)
.env.local.example — Key template
CLAUDE.md        — Orchestrator config for Claude Code
PROJECT-BRIEF.md — This file
README.md        — Quick start
```

---

*Last updated: 2026-06-03 — 48 SMS sent MTD. EIN obtained. A2P 10DLC Brand submitted (pending). Diagnoser channel routing bug fixed. Next: Campaign approval → Stripe + Formspree → deploy website.*
