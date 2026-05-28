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

### Done (continued)
- [x] `scripts/mobile.js` — positive reply handler, weekday slot suggestions, owner approval gate, Nora upsell scheduler
- [x] `run-daily.sh` — one-command daily pipeline runner with manual-step pauses

### Done (continued)
- [x] **First dry run** — full pipeline tested with 5 mock Phoenix plumber leads. All 5 briefs generated, all 5 checker-approved (1 rewrite), all 5 Lovable prompts built, Pitcher dry-run previewed. Total cost: $0.008.
- [x] **Channel fix** — Diagnoser no longer overrides Scout's channel assignment. Scout is now authoritative.
- [x] **Outscraper polling fix** — Scout was polling wrong URL (`api.app.outscraper.com/tasks/`). Now correctly uses `results_location` from initial response (`api.outscraper.cloud/requests/`).
- [x] **Scout runs locally** — Outscraper API is blocked from remote container (cloud IP restriction). Scout must be run on local machine; all other scripts run fine from container.
- [x] **Lead filter expanded** — max reviews raised from 100 → 300 to capture more qualifying leads in larger cities.
- [x] **First real Scout run** — Denver plumbers successfully pulled from Outscraper on local machine.

### Next Actions (in order)
1. [ ] **Push Denver leads** — run `git add leads/ state.json config/ && git commit -m "Scout: Denver plumbers" && git push origin claude/kind-hypatia-3YzM0` from local machine
2. [ ] **Get business name** — needed for sender identity before going live
3. [ ] **Get Resend API key** — resend.com, needed for email sends
4. [ ] **Set `FROM_EMAIL` + `FROM_NAME`** — your sender email and name in `.env.local`
5. [ ] **Run Diagnoser → Pitcher dry-run** on real Denver leads (done from this container after leads are pushed)
6. [ ] **Get Twilio credentials** — for SMS channel (electricians, roofers)
7. [ ] **First live send** — remove `--dry-run`, send to real leads
8. [ ] **Set up Cal.com link** — add `CALCOM_LINK` to `.env.local` for Mobile booking drafts
9. [ ] **Reply detection** — no automated inbound monitoring yet; must manually set `"status": "positive"` in messages JSON

### Known Issues / Notes
- [x] **Email field missing** — fixed. Scout captures email, Diagnoser passes through.
- [x] **Channel override** — fixed. Scout assignment locked.
- [x] **Outscraper polling** — fixed. Uses `results_location` URL.
- [ ] **Scout must run locally** — remote container IP blocked by Outscraper. Document in onboarding.
- [ ] **`years_on_maps` enrichment** — always `null`. Filter unenforced.
- [ ] **Reply detection** — manual for now. Future: Twilio/Resend webhooks.
- [ ] **Verify `cost_per_result`** — default $0.001. Confirm in Outscraper dashboard.

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
  scout.js             — ✅ Live (async task polling, email field)
  diagnoser.js         — ✅ Live (email passed through pipeline)
  checker.js           — ✅ Live (5 evals + rewrite loop)
  pitcher.js           — ✅ Live
  builder.js           — ✅ Live
  filmer.js            — ✅ Live
  mobile.js            — ✅ Live (reply handler, approval gate, Nora upsell)
  logger.js            — ✅ Shared log writer (all scripts → logs/{date}.log)

run-daily.sh           — ✅ One-command daily pipeline runner

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
| Mobile | ✅ Live | Books calls from replies + Nora upsell | Real-time |

---

## Pipeline (current)

**Quick start (recommended):**
```bash
npm install                   # first time only
cp .env.local.example .env.local  # fill in your API keys
./run-daily.sh                # runs all 6 steps in order, pauses at manual steps
./run-daily.sh --dry-run      # preview Pitcher output without sending
```

**Step by step (manual):**
```bash
node scripts/scout.js --city "Austin, TX" --trade plumber --force    # Step 1
node scripts/diagnoser.js --force                                     # Step 2
node scripts/checker.js --force                                       # Step 3
node scripts/builder.js --force                                       # Step 4a — generate Lovable prompts
# → paste each into lovable.dev, copy deploy URL, then:
node scripts/builder.js --submit --lead {id} --url {url}             # Step 4b — record URL
node scripts/filmer.js --force                                        # Step 5a — write Loom instructions
# → record 60-sec Loom walkthrough, then:
node scripts/filmer.js --submit --lead {id} --url loom:{url}         # Step 5b — record video URL
node scripts/pitcher.js --dry-run --force                            # Step 6 — preview
node scripts/pitcher.js --force                                       # Step 6 — send

# When a positive reply comes in:
# Set "status": "positive" in messages/{lead_id}-sent.json, then:
node scripts/mobile.js                                               # Step 7 — book call
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
