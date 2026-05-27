# Maps Agency — Project Brief for Consultant Review

**Date:** May 27, 2026
**Owner:** Solo operator
**Status:** All 7 agents built. Not yet live. First test run scheduled this week.

---

## What This Is

A solo AI agency that sells websites and voice agents to home service contractors
(plumbers, HVAC techs, electricians, roofers, handymen). The entire outbound sales
pipeline — from finding leads to sending the first message — is automated through
a system of 7 Node.js scripts orchestrated by Claude Code.

The owner's role is to:
1. Approve or edit AI-generated outreach messages before sending (via CLI)
2. Manually paste Lovable prompts to build mockup sites
3. Record a 60-second Loom walkthrough of each mockup
4. Respond to positive replies via the Mobile agent (approve/edit/skip in terminal)

Everything else is automated.

---

## Revenue Model

| Product | Price | Type |
|---|---|---|
| Website build | $400 | One-time |
| Nora voice agent | $399/mo | Recurring standalone |
| Bundle (hosting + Nora) | $350/mo | Recurring |

**Target:** 47 clients/month → ~$18,800/mo recurring at scale

---

## The 7 Agents

### 1. Scout (`scripts/scout.js`)
Pulls contractor leads from Google Maps via the Outscraper API. Filters by review
count (5–100) and rating (4.0+). Scores each lead by "gap" — how much they need a
website. Assigns outreach channel by trade.

- **Output:** `/leads/{city}-{trade}-{date}.json`
- **Cost cap:** $10/mo (Outscraper)
- **Channel assignment:** plumbers/HVAC → email; electricians/roofers → SMS; handymen → IG DM

### 2. Diagnoser (`scripts/diagnoser.js`)
Sends each lead to Claude Haiku with prompt caching. Generates a brief containing a
diagnosis of their online presence, a hero angle (their best differentiator), a tone
setting, and a personalized cold message under 80 words. Marks top 5 leads as
priority for Builder.

- **Output:** `/queue/{lead_id}-brief.json`
- **Cost cap:** $5/mo (~$0.001 per brief)
- **Model:** Claude Haiku with ephemeral caching (system prompt cached once per session)

### 3. Checker (`scripts/checker.js`)
Quality-gates every cold message before it can be sent. Runs 5 local evals (no API
cost). If any fail, calls Claude for a rewrite (max 2 attempts). If still failing
after 2 rewrites, flags for human review.

**5 Evals:**
1. Personalization — business name + trade + local signal, score ≥75/100
2. No AI markers — "Certainly!", "As an AI", "I'd be happy to", etc.
3. No buzzwords — "game-changing", "leverage", "seamlessly", etc.
4. Structure — 20–80 words, ends with one question, ≤3 sentences before it
5. No spammy openers — "Just reaching out", "I came across your", "My name is", etc.

- **Cost cap:** $3/mo (rewrites only, ~$0.0003 each)

### 4. Builder (`scripts/builder.js`)
Generates a filled-in Lovable.dev prompt for the top 5 priority leads. Trade-specific
colors and service copy. Owner pastes each prompt into lovable.dev, gets a deploy URL,
then runs `--submit` to record it. No API integration with Lovable (no public API).

- **Daily limit:** 5 mockups
- **No API cost**

### 5. Filmer (`scripts/filmer.js`)
Optionally captures a mobile screenshot via ScreenshotOne, then writes step-by-step
Loom recording instructions. Owner records a 60-second walkthrough and submits the
URL. Pitcher attaches the video link to outreach.

- **Daily limit:** 5 videos
- **Optional API:** ScreenshotOne (screenshot only; Higgsfield.ai video generation not integrated)

### 6. Pitcher (`scripts/pitcher.js`)
Sends the approved cold message + Loom video link to each lead via the right channel.
Only sends if `checker_approved = true`. Supports `--dry-run` to preview without
sending.

- **Email:** Resend API
- **SMS:** Twilio
- **IG DM / LinkedIn:** Writes a manual draft for owner to send
- **Daily limit:** 30 messages

### 7. Mobile (`scripts/mobile.js`)
Handles positive replies. Scans `/messages/` for leads with `status: "positive"`,
drafts a reply with booking slots (Cal.com link or 3 suggested weekdays), and
presents a terminal approval card. Owner types A/E/S — nothing sends without
explicit approval. Also checks daily for Nora upsell opportunities 7 days after
each closed deal.

- **Fully interactive** — no sends without owner input
- **Cal.com:** Uses link from `.env.local` if set; otherwise suggests next 3 weekdays

---

## Daily Run (Full Pipeline)

```bash
./run-daily.sh          # walks through all 6 steps, pauses at manual steps
./run-daily.sh --dry-run  # preview Pitcher output without sending
```

Or step by step:
```
Scout → Diagnoser → Checker → Builder (manual Lovable) → Filmer (manual Loom) → Pitcher → Mobile
```

Typical active time per day: **60–90 minutes** (mostly the manual Lovable + Loom steps).

---

## Lead State Machine

```
scouted → diagnosed → checked → mockup_pending → mockup_ready → film_pending → filmed → sent → [positive] → call_booked → hot
```

All state written to `state.json`. Each agent reads only its expected input states.

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
| Runtime | Node.js (no framework) | Simple, no build step, easy to run on any machine |
| AI | Claude Haiku via Anthropic SDK | Cheapest capable model; prompt caching cuts costs ~80% |
| Lead source | Outscraper Google Maps API | Best contractor data, async task polling |
| Email | Resend | Clean API, reliable deliverability |
| SMS | Twilio | Standard, already in use for Nora |
| Site builder | Lovable.dev | Fast no-code HTML pages, no API needed |
| Video | Loom (manual) | No Higgsfield.ai API access yet |
| State | Flat JSON (`state.json`) | No DB overhead for a 47-client operation |

---

## What's Not Built Yet

| Gap | Impact | Notes |
|---|---|---|
| Inbound reply detection | Medium | Pitcher logs outbound sends. Marking a reply "positive" is manual (edit JSON). No webhook/inbox polling yet. |
| `years_on_maps` filter | Low | Outscraper doesn't return this field. All leads pass this filter by default. |
| Higgsfield.ai video | Low | Loom is the fallback — works fine, just requires 5 manual recordings/day |
| Auto-run / scheduling | Low | All scripts require `--force`. No cron job yet. |
| Reply inbox | Medium | No Twilio/Resend webhook set up. Replies aren't detected automatically. |

---

## Key Risks / Questions for Consultant

1. **Reply detection gap** — There's no inbound message monitoring. A contractor
   could reply to an SMS or email and nothing happens unless the owner manually
   checks Twilio/Resend dashboards and updates the JSON file. This breaks the
   "hands-off" promise of the system. How would you solve this?

2. **Lovable + Loom are daily manual work** — Owner spends 30–45 min/day on
   these two steps. Is there a tighter integration (Lovable API roadmap? Loom
   auto-record via API?) or a different approach to site mockups worth considering?

3. **Email channel effectiveness** — Outbound cold email to contractors is hard.
   Deliverability, domain reputation, and open rates matter. Is Resend + a cold
   domain the right setup? Is there a better cold outreach stack for this niche?

4. **47 clients/month at $400** — Is this volume realistic from cold outreach alone?
   What's a typical conversion funnel (leads → reply → call → close) for this type
   of business?

5. **Nora voice agent** — The Nora upsell is a key part of the revenue model but
   the underlying Nora product isn't part of this repo. Is the 7-day upsell timing
   right? What's the conversion rate expectation from website close → Nora sale?

6. **State management at scale** — `state.json` is a flat file. At 47 clients/mo
   with 30 leads/day that's 900 leads/month passing through. Will this hold up, or
   should we move to SQLite early?

7. **Contractor email availability** — Outscraper rarely returns emails for small
   contractors. The email channel may have very low hit rates in practice. Should
   the channel assignment strategy change, or should we add a secondary email
   enrichment step?

---

## Repo Structure

```
/agents/         — System prompts for all 7 agents (Claude reads these)
/config/         — Per-agent budget caps and daily counters (JSON)
/leads/          — Raw lead files from Scout
/queue/          — Brief files from Diagnoser (one per lead)
/mockups/        — Lovable URLs, screenshots, Loom video links
/messages/       — Outreach records from Pitcher (one per lead)
/logs/           — Daily append-only log files
/scripts/        — All 7 runnable Node.js agent scripts
state.json       — Shared lead state (single source of truth)
run-daily.sh     — Full pipeline runner
.env.local       — API keys (gitignored)
CLAUDE.md        — Orchestrator config for Claude Code sessions
```

---

*This document was auto-generated from the live codebase on 2026-05-27.*
