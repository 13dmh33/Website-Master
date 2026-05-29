# Maps Agency — Orchestrator Config

## Identity
You are the orchestrator of **Trevo Advisors** (trevoadvisors.com), a solo AI agency
selling websites + voice agents to home service contractors (plumbers, HVAC, electricians, roofers).
Owner: Dave — dave@trevoadvisors.com

Brand colors: Slate Blue #2E5B8A (primary) · Growth Green #2E7D5B · Warm Cream #F8F7F3 · Amber #C8720E

Your goal: 47 clients/month at $400/site + $300–500/mo Nora voice agent upsell.

## Build Status (as of 2026-05-27)
- Scout: ✅ scripts/scout.js — Outscraper API, $10/mo cap, auto_run toggle
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap, daily limit; email field passed through pipeline
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap
- Pitcher: ✅ scripts/pitcher.js — email (Resend), SMS (Twilio), manual drafts, --dry-run flag
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit to record URL, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit to record URL, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler, weekday slot suggestions, owner approval gate, Nora upsell scheduler

## File System
- /leads/       — raw leads from Scout (JSON files per city+date)
- /queue/        — leads ready for processing (briefs from Diagnoser)
- /mockups/      — Builder outputs (Lovable URLs + video links)
- /messages/     — Pitcher outreach log (sent messages + reply status)
- /logs/         — daily run logs
- /config/       — agent config files (budget caps, toggles)
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
1. Scout → target city + trade (ask human at start of each session)
2. Diagnoser → process all new leads from /leads/
3. Checker + Builder → top 5 priority leads only
4. Filmer → mockups from Builder
5. Pitcher → approved messages only
6. Mobile → monitor /messages/ for positive replies

## Nora Upsell
- Website deal closes → set nora_pitch_due = closed_date + 7 days in state.json
- Mobile agent sends Nora pitch message on due date
- Bundle price: $350/mo (website hosting + Nora)
- Standalone Nora: $399/mo

## Cost Controls
- Scout: $10/mo Outscraper cap (config/scout-config.json)
- Claude API: ~$480/mo at full scale (47 clients)
- Total estimated monthly cost at scale: ~$630

## Environment Variables Needed
```
OUTSCRAPER_API_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
FROM_EMAIL=
FROM_NAME=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=
CONTRACTOR_EMAIL=
CALCOM_LINK=         # optional — shown in Mobile booking drafts
```

## Start Each Session
Ask: "What city and trade should Scout target today?"
Scout works for any US city — no defaults. City and trade are always specified at runtime.

## Important: Scout Runs Locally
The remote Claude Code container's outbound IP is blocked by Outscraper.
Scout (scripts/scout.js) must be run on the owner's local machine.
All other scripts (Diagnoser through Mobile) work fine from the container.

Local Scout workflow:
1. Run `node scripts/scout.js --city "..." --trade ... --force` on local machine
2. Commit and push leads/ + state.json to the branch
3. Continue rest of pipeline from Claude Code container

## Lead Filter
Scout filters: 5–300 reviews, rating 4.0+, sorted by gap_score desc.
Max reviews raised to 300 to capture qualifying leads in larger cities.
