# Website Master — Maps Agency

Solo AI agency system for selling websites + Nora voice agent bundles to home service contractors.

## Revenue Model

- Website: $400 one-time
- Nora voice agent: $300–500/mo
- Bundle: $350/mo (website hosting + Nora)
- Target: 47 clients/mo = ~$18K/mo

---

## Project Status

### Done
- [x] Full folder structure (`leads/`, `queue/`, `mockups/`, `messages/`, `logs/`)
- [x] `CLAUDE.md` — orchestrator config for Claude Code
- [x] `state.json` — shared lead state schema
- [x] All 7 agent system prompt files in `/agents/`
- [x] `scripts/scout.js` — Outscraper API, $10/mo cap, auto_run toggle
- [x] `scripts/diagnoser.js` — Claude Haiku, prompt caching, daily limit + $5/mo cap
- [x] `scripts/checker.js` — 5 evals (personalization, AI markers, buzzwords, structure, spammy openers) + Claude rewrite loop, $3/mo cap

### In Progress
- [ ] `scripts/pitcher.js` — email (Resend) + SMS (Twilio) outreach sender

### Not Started
- [ ] `scripts/builder.js` — Lovable.dev mockup generation
- [ ] `scripts/filmer.js` — Higgsfield/screenshot video rendering
- [ ] `scripts/mobile.js` — reply handler + Calendly booking
- [ ] First live test run

### Known Issues / Future Tasks
- [ ] **Outscraper async responses** — Maps v3 API may return a task ID on some plans. Need polling logic. Current script works for sync responses only.
- [ ] **`years_on_maps` enrichment** — field is `null` on all leads. "5+ years on Maps" filter unenforced until enrichment step added.
- [ ] **Verify `cost_per_result`** — default is `$0.001`. Check actual Outscraper rate in dashboard and update `config/scout-config.json`.

---

## Repo Structure

```
/agents/               — System prompts for all 7 agents
  scout.md             — ✅ Outscraper integration docs
  diagnoser.md         — ✅ Brief + message format + script usage
  checker.md           — ✅ 5-eval quality gate + script usage
  builder.md           — ✅ Lovable prompt template
  filmer.md            — ✅ Screenshot + video spec
  pitcher.md           — ✅ Multi-channel send logic
  mobile.md            — ✅ Reply handler + Calendly flow

/config/
  scout-config.json    — ✅ $10/mo cap, auto_run toggle
  diagnoser-config.json — ✅ $5/mo cap, daily limit 30
  checker-config.json  — ✅ $3/mo cap, daily limit 30

/scripts/
  scout.js             — ✅ Live
  diagnoser.js         — ✅ Live
  checker.js           — ✅ Live (5 evals + rewrite loop)
  pitcher.js           — 🔲 Building now

/leads/                — Raw leads from Scout
/queue/                — Briefs from Diagnoser (checker_approved flag)
/mockups/              — Lovable URLs + video links
/messages/             — Outreach log from Pitcher
/logs/                 — Daily run logs

CLAUDE.md              — Orchestrator config
state.json             — Shared lead state
.env.local.example     — API key template
package.json           — npm scripts + dependencies
```

---

## 7 Agents

| Agent | Status | Role | Daily Output |
|---|---|---|---|
| Scout | ✅ Live | Finds leads on Google Maps via Outscraper | 30 leads |
| Diagnoser | ✅ Live | Writes briefs + cold messages via Claude Haiku | 30 briefs |
| Checker | ✅ Live | 5 evals + Claude rewrite loop | Blocks/approves |
| Builder | 🔲 Prompt only | Builds Lovable mockups | 5 sites |
| Filmer | 🔲 Prompt only | Renders 10s vertical video | 5 videos |
| Pitcher | 🔲 Building | Sends outreach by channel (email + SMS) | 30 messages |
| Mobile | 🔲 Prompt only | Books calls from replies | Real-time |

---

## Pipeline (current)

```bash
npm install                                                          # first time only
cp .env.local.example .env.local                                     # add your keys

node scripts/scout.js --city "Austin, TX" --trade plumber --force    # Step 1
node scripts/diagnoser.js --force                                     # Step 2
node scripts/checker.js --force                                       # Step 3
# node scripts/pitcher.js --force                                     # Step 4 — coming next
```

Supported trades: `plumber`, `hvac`, `electrician`, `roofer`, `handyman`

---

## Cost Controls Per Script

| Script | Cap | Tracking File |
|---|---|---|
| scout.js | $10/mo (Outscraper) | config/scout-config.json |
| diagnoser.js | $5/mo + 30/day (Claude) | config/diagnoser-config.json |
| checker.js | $3/mo + 30/day (Claude rewrites only) | config/checker-config.json |

All scripts respect `auto_run: false` — require `--force` flag in manual/testing mode.

---

## Required Accounts

| Service | Used By | Notes |
|---|---|---|
| Anthropic API | Diagnoser, Checker | console.anthropic.com |
| Outscraper | Scout | outscraper.com — verify cost_per_result in dashboard |
| Resend | Pitcher (email) | resend.com |
| Twilio | Pitcher (SMS) | reuse from Nora Agent |
| Lovable.dev | Builder | lovable.dev |
| Higgsfield.ai | Filmer | Optional — Loom works as fallback |
| Calendly | Mobile | calendly.com |
