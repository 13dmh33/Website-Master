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

### Done (continued)
- [x] `scripts/pitcher.js` — email (Resend) + SMS (Twilio), manual drafts for ig_dm/linkedin, --dry-run flag

### Done (continued)
- [x] `scripts/builder.js` — Lovable prompt generator (5/day), `--submit` to record URL
- [x] `scripts/filmer.js` — Loom instructions + optional ScreenshotOne capture, `--submit` to record URL

### Not Started
- [ ] `scripts/mobile.js` — reply handler + Cal.com booking
- [ ] First live test run

### Known Issues / Future Tasks
- [x] **Outscraper async responses** — polling logic added. Scout now handles task IDs via `pollTask()` (2s interval, 60s timeout).
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
  mobile.md            — ✅ Reply handler + Cal.com flow

/config/
  scout-config.json    — ✅ $10/mo cap, auto_run toggle
  diagnoser-config.json — ✅ $5/mo cap, daily limit 30
  checker-config.json  — ✅ $3/mo cap, daily limit 30

/scripts/
  scout.js             — ✅ Live (async task polling added)
  diagnoser.js         — ✅ Live
  checker.js           — ✅ Live (5 evals + rewrite loop)
  pitcher.js           — ✅ Live
  logger.js            — ✅ Shared log writer (all scripts → logs/{date}.log)

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
| Builder | ✅ Live | Generates Lovable prompts + records URLs | 5 sites |
| Filmer | ✅ Live | Loom instructions + ScreenshotOne capture | 5 videos |
| Pitcher | ✅ Live | Sends outreach by channel (email + SMS + manual drafts) | 30 messages |
| Mobile | 🔲 Prompt only | Books calls from replies | Real-time |

---

## Pipeline (current)

```bash
npm install                                                          # first time only
cp .env.local.example .env.local                                     # add your keys

node scripts/scout.js --city "Austin, TX" --trade plumber --force    # Step 1
node scripts/diagnoser.js --force                                     # Step 2
node scripts/checker.js --force                                       # Step 3
node scripts/builder.js --force                                       # Step 4a — generate Lovable prompts
# → paste each into lovable.dev, copy deploy URL, then:
node scripts/builder.js --submit --lead {id} --url {url}             # Step 4b — record URL
node scripts/filmer.js --force                                        # Step 5a — write Loom instructions
# → record Loom walkthrough, then:
node scripts/filmer.js --submit --lead {id} --url loom:{url}         # Step 5b — record video URL
node scripts/pitcher.js --dry-run --force                            # Step 6 — preview
node scripts/pitcher.js --force                                       # Step 6 — send
```

Supported trades: `plumber`, `hvac`, `electrician`, `roofer`, `handyman`

---

## Cost Controls Per Script

| Script | Cap | Tracking File |
|---|---|---|
| scout.js | $10/mo (Outscraper) | config/scout-config.json |
| diagnoser.js | $5/mo + 30/day (Claude) | config/diagnoser-config.json |
| checker.js | $3/mo + 30/day (Claude rewrites only) | config/checker-config.json |
| pitcher.js | 30/day send limit (no Claude cost) | config/pitcher-config.json |
| builder.js | 5/day mockup limit (no API cost) | config/builder-config.json |
| filmer.js | 5/day limit (no API cost) | config/filmer-config.json |

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
| Cal.com | Mobile | cal.com |
