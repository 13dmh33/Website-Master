# Trevo Advisors — Project Brief

**Date:** May 28, 2026
**Owner:** Dave Hettinger — dave@trevoadvisors.com
**Website:** trevoadvisors.com
**Status:** All 7 agents built and tested. Pipeline proven on real data. First live send pending Twilio setup.

---

## What This Is

Trevo Advisors is a solo AI agency that sells websites and voice agents to home service
contractors (plumbers, HVAC techs, electricians, roofers, handymen). The entire outbound
sales pipeline — from finding leads to sending the first message — is automated through
a system of 7 Node.js scripts orchestrated by Claude Code.

**Dave's daily role:**
1. Run Scout locally (Outscraper blocked from cloud container — see note below)
2. Approve or edit AI-generated outreach messages before sending (CLI)
3. Paste Lovable prompts to build mockup sites (~5/day)
4. Record a 60-second Loom walkthrough of each mockup (~5/day)
5. Respond to positive replies via Mobile agent (approve/edit/skip in terminal)

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

| Agent | Script | Status | Tested |
|---|---|---|---|
| Scout | scout.js | ✅ Live | ✅ Real Denver leads pulled |
| Diagnoser | diagnoser.js | ✅ Live | ✅ Real brief generated, $0.001 |
| Checker | checker.js | ✅ Live | ✅ 100/100 score, no rewrites |
| Builder | builder.js | ✅ Live | ✅ Lovable prompts generated |
| Filmer | filmer.js | ✅ Live | ✅ Loom instructions generated |
| Pitcher | pitcher.js | ✅ Live | ✅ Dry-run previewed |
| Mobile | mobile.js | ✅ Live | ✅ Auto-send complete, awaiting first real reply |

---

## The 7 Agents

### 1. Scout (`scripts/scout.js`)
Pulls contractor leads from Google Maps via the Outscraper API. Filters by review
count (5–300) and rating (4.0+). Scores each lead by "gap" — how much they need a
website. Assigns outreach channel by trade.

- **Output:** `/leads/{city}-{trade}-{date}-run{n}.json`
- **Cost cap:** $10/mo (Outscraper)
- **Channel assignment:** plumbers/HVAC → email; electricians/roofers → SMS; handymen → IG DM
- **⚠️ Must run locally** — Outscraper blocks cloud container IPs. Run on local machine, push leads to repo, continue pipeline from container.

### 2. Diagnoser (`scripts/diagnoser.js`)
Sends each lead to Claude Haiku with prompt caching. Generates a structured brief:
diagnosis, hero angle, tone, and personalized cold message under 80 words. Marks top
5 leads as priority for Builder.

- **Output:** `/queue/{lead_id}-brief.json`
- **Cost cap:** $5/mo (~$0.001 per brief)
- **Model:** Claude Haiku with ephemeral caching

### 3. Checker (`scripts/checker.js`)
Quality-gates every cold message before it can be sent. Runs 5 local evals (no API
cost). If any fail, calls Claude for a rewrite (max 2 attempts). Flags for human
review if still failing.

**5 Evals (all run locally — no API cost):**
1. Personalization — business name + trade + local signal, score ≥75/100
2. No AI markers — "Certainly!", "As an AI", "I'd be happy to", etc.
3. No buzzwords — "game-changing", "leverage", "seamlessly", etc.
4. Structure — 20–80 words, ends with one question, ≤3 sentences before it
5. No spammy openers — "Just reaching out", "I came across your", "My name is", etc.

- **Cost cap:** $3/mo (rewrites only, ~$0.0003 each)

### 4. Builder (`scripts/builder.js`)
Generates a filled-in Lovable.dev prompt for the top 5 priority leads. Uses
trade-specific colors; falls back to Trevo's Slate Blue (#2E5B8A) for unknown trades.
Owner pastes each prompt into lovable.dev, copies the deploy URL, submits it.

- **Daily limit:** 5 mockups / No API cost

### 5. Filmer (`scripts/filmer.js`)
Optionally captures a mobile screenshot via ScreenshotOne, then writes Loom recording
instructions. Owner records a 60-second walkthrough and submits the URL. Pitcher
attaches the video link to outreach.

- **Daily limit:** 5 videos / No API cost (ScreenshotOne optional)

### 6. Pitcher (`scripts/pitcher.js`)
Sends the approved cold message + Loom video link via the right channel.
Only sends if `checker_approved = true`. Supports `--dry-run` to preview first.

- **Email:** Resend API — from Dave / dave@trevoadvisors.com
- **SMS:** Twilio
- **IG DM / LinkedIn:** Manual draft written to `/messages/`
- **Daily limit:** 30 messages

### 7. Mobile (`scripts/mobile.js`)
Handles positive replies automatically. Scans `/messages/` for `status: "positive"`,
drafts a booking reply with 4 time slots spread across the next 2 weeks
(Mon/Wed/Thu preferred, 10am/2pm/4pm rotation), and sends immediately via the same
channel as the original outreach. Also runs daily Nora upsell check (7 days after
each closed deal) — auto-sends the pitch on the due date.

- **Fully automatic** — no owner input required, sends on run
- Cal.com link appended if `CALCOM_LINK` set in `.env.local` (optional)

---

## Daily Run

```bash
# On local machine first:
node scripts/scout.js --city "Denver, CO" --trade plumber --force
git add leads/ state.json && git commit -m "Scout run" && git push origin claude/kind-hypatia-3YzM0

# Then from Claude Code container (or local):
./run-daily.sh           # full pipeline with manual-step pauses
./run-daily.sh --dry-run # preview only
```

**Typical active time:** 60–90 min/day (mostly Lovable + Loom manual steps)

---

## Lead State Machine

```
scouted → diagnosed → checked → mockup_pending → mockup_ready → film_pending → filmed → sent → [positive] → call_booked → hot
```

---

## What's Still Needed to Go Live

| Item | Status | Notes |
|---|---|---|
| Twilio credentials | ✅ Configured | ACdb3cd77... / +17209027555 |
| Resend API key | ❌ Missing | Needed for email channel (plumbers/HVAC) |
| Domain verified in Resend | ❌ Missing | trevoadvisors.com must be verified before sending email |
| Scout run (electricians/roofers) | ❌ Pending | Run locally → push leads → run pipeline from container |
| Cal.com link | ❌ Optional | Add to `.env.local` for booking drafts |

**Ready to send SMS now** — run Scout locally for electricians or roofers, push leads, run pipeline from container. Email channel needs Resend setup.

---

## Cost at Scale (47 clients/month)

| Service | Monthly Cost |
|---|---|
| Outscraper (Scout) | ~$2/mo |
| Anthropic API (Diagnoser + Checker) | ~$16/mo |
| Resend (email) | ~$20/mo |
| Twilio (SMS) | ~$5–10/mo |
| **Total infrastructure** | **~$45/mo** |

At $400/site × 47 = $18,800/mo revenue, infrastructure is <0.25% of revenue.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (no framework) | Simple, no build step, runs anywhere |
| AI | Claude Haiku via Anthropic SDK | Cheapest capable model; prompt caching ~80% cheaper |
| Lead source | Outscraper Google Maps API | Best contractor data |
| Email | Resend | Clean API, strong deliverability |
| SMS | Twilio | Reliable, standard |
| Site builder | Lovable.dev | Fast no-code pages, no API needed |
| Video | Loom (manual) | Higgsfield.ai not integrated yet |
| State | Flat JSON (`state.json`) | No DB overhead at current scale |

---

## Known Gaps

| Gap | Priority | Notes |
|---|---|---|
| Inbound reply detection | Medium | Must manually set `"status": "positive"` in messages JSON. No webhook yet. |
| Contractor email availability | Medium | Outscraper rarely returns emails for small contractors. SMS first is the workaround. |
| Scout runs locally only | Low | Cloud container IP blocked by Outscraper. 2-command local workflow documented. |
| `years_on_maps` filter | Low | Outscraper doesn't return this field. Filter unenforced. |
| Higgsfield.ai video | Low | Loom works fine as manual fallback |
| Auto-run / scheduling | Low | All scripts require `--force`. No cron job yet. |

---

## Questions for Consultant

1. **Reply detection** — No inbound monitoring. Owner must check Twilio/Resend dashboards manually and update JSON. How would you solve this at low cost?

2. **Lovable + Loom as daily manual work** — 30–45 min/day at volume. Is there a tighter path (Lovable API, auto-screen-record) worth pursuing now vs. later?

3. **Email deliverability** — Cold email to contractors from a new domain is risky. Is Resend + trevoadvisors.com the right setup, or is there a better cold outreach stack for this niche?

4. **47 clients/month reality check** — Is this volume achievable from cold outreach alone? What's a realistic conversion funnel (leads → reply → call → close)?

5. **Nora upsell** — Nora isn't in this repo. Is 7-day timing right? What's a realistic close rate from website client → Nora add-on?

6. **State management at scale** — `state.json` is a flat file. 30 leads/day = ~900/month. When should this move to SQLite?

7. **SMS for contractors** — Roofers and electricians get SMS. Is cold SMS to a business number effective, or does it get ignored/blocked?

---

## Repo Structure

```
/agents/         — System prompts for all 7 agents
/config/         — Budget caps, counters, brand.json
/leads/          — Raw lead files from Scout
/queue/          — Brief files from Diagnoser
/mockups/        — Lovable URLs, screenshots, Loom links
/messages/       — Outreach records from Pitcher
/logs/           — Daily append-only logs
/scripts/        — All 7 Node.js agent scripts
state.json       — Shared lead state
run-daily.sh     — Full pipeline runner
.env.local       — API keys (gitignored)
CLAUDE.md        — Orchestrator config for Claude Code
PROJECT-BRIEF.md — This file
```

---

*Last updated: 2026-05-29 — Twilio configured, Mobile auto-send complete, all 7 agents live. Ready for first SMS send (needs Scout run locally for electricians/roofers).*
