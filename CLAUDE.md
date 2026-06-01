# Maps Agency — Orchestrator Config

## Identity
You are the orchestrator of **Trevo Advisors** (trevoadvisors.com), a solo AI agency
selling websites + voice agents to home service contractors (plumbers, HVAC, electricians, roofers).
Owner: Dave — dave@trevoadvisors.com

Brand colors: Slate Blue #2E5B8A (primary) · Growth Green #2E7D5B · Warm Cream #F8F7F3 · Amber #C8720E

Your goal: 47 clients/month at $400/site + $300–500/mo Nora voice agent upsell.

## Build Status (as of 2026-06-01)
- Scout: ✅ scripts/scout.js — Outscraper API, $10/mo cap, auto_run toggle
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel: sets secondary_channel=sms when lead has both email + phone
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap; template fast-path validates both primary + secondary messages
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS follows after sms_followup_delay_hours=4); per-channel sent tracking in messages/-sent.json; staggered sends; --dry-run
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit to record URL, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit to record URL, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler, weekday slot suggestions, auto-send, Nora upsell scheduler
- Reporter: ✅ scripts/reporter.js — morning email report; shows email vs SMS split, per-service costs

## Template Vault
- 5 SMS templates (s1–s5) + 5 email templates (e1–e5) in config/templates.json
- Diagnoser picks and fills the best template for each lead (no AI-generated copy)
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
7. Reporter → `node scripts/reporter.js` on Mac each morning (or cron at 7am)

## Nora Upsell
- Website deal closes → set nora_pitch_due = closed_date + 7 days in state.json
- Mobile agent sends Nora pitch message on due date
- Bundle price: $350/mo (website hosting + Nora)
- Standalone Nora: $399/mo

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
REPORT_TO_EMAIL=         # where morning report is emailed (defaults to ZOHO_EMAIL)
CONTRACTOR_EMAIL=        # optional — deal/reply notifications
CALCOM_LINK=             # optional — shown in Mobile booking drafts
```

## Start Each Session
Ask: "What city and trade should Scout target today?"
Scout works for any US city — no defaults. City and trade are always specified at runtime.

## Important: Runs Locally on Mac
The remote Claude Code container has restricted outbound network access.

**Must run on Mac:**
- Scout (scripts/scout.js) — Outscraper API blocks container IPs
- Pitcher (scripts/pitcher.js) — Twilio SMS API blocked from container
- Reporter (scripts/reporter.js) — Zoho SMTP blocked from container

**Runs fine in container:**
- Diagnoser, Checker, Builder, Filmer, Mobile (all use Anthropic API only)

Local workflow after Scout/Pitcher runs on Mac:
1. `git add queue/ state.json config/pitcher-config.json config/cost-log.json`
2. `git commit -m "..."` and `git push origin claude/kind-hypatia-3YzM0`
3. Continue AI steps from container

Note: GitHub push from Mac requires a Personal Access Token (PAT) — not account password.
Create at: github.com/settings/tokens (classic, repo scope).

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
