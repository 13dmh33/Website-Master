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
- [x] `scripts/scout.js` — Outscraper API integration with cost controls
- [x] `config/scout-config.json` — $10/mo budget cap, auto_run toggle

### In Progress
- [ ] `scripts/checker.js` — quality-gates cold messages (4 evals + auto-rewrite)

### Known Issues / Future Tasks
- [ ] **Outscraper async responses** — Maps v3 API may return a task ID instead of direct results on some plans. Need to add polling logic (`GET /tasks/{id}`) to handle async responses. Current script works for sync responses only.
- [ ] **`years_on_maps` enrichment** — Outscraper doesn't return this field. Currently `null` on all leads. The "5+ years on Maps" filter is unenforced until an enrichment step is added.
- [ ] **Verify `cost_per_result`** — Default is `$0.001`. Check your actual Outscraper rate in your dashboard and update `config/scout-config.json` before relying on budget tracking.

### Not Started
- [ ] `scripts/builder.js` — Lovable.dev mockup generation
- [ ] `scripts/filmer.js` — Higgsfield/screenshot video rendering
- [ ] `scripts/pitcher.js` — multi-channel outreach sender
- [ ] `scripts/mobile.js` — reply handler + Calendly booking
- [ ] `.env.local` setup guide
- [ ] First live test run (Denver plumbers)

---

## Repo Structure

```
/agents/               — System prompts for all 7 agents
  scout.md             — ✅ Outscraper integration docs
  diagnoser.md         — ✅ Brief + message format
  checker.md           — ✅ 4-eval quality gate
  builder.md           — ✅ Lovable prompt template
  filmer.md            — ✅ Screenshot + video spec
  pitcher.md           — ✅ Multi-channel send logic
  mobile.md            — ✅ Reply handler + Calendly flow

/config/
  scout-config.json    — ✅ Budget cap + auto_run toggle

/scripts/
  scout.js             — ✅ Live (Outscraper + cost controls)
  diagnoser.js         — ✅ Live (Claude Haiku + prompt caching + cost controls)
  checker.js           — ✅ Live (4 local evals + Claude rewrite loop)

/leads/                — Raw leads from Scout (JSON per city+date)
/queue/                — Processed briefs from Diagnoser
/mockups/              — Lovable URLs + video links
/messages/             — Outreach log
/logs/                 — Daily run logs

CLAUDE.md              — Orchestrator config (Claude Code reads at startup)
state.json             — Shared lead state across all agents
```

---

## 7 Agents

| Agent | Status | Role | Daily Output |
|---|---|---|---|
| Scout | ✅ Script ready | Finds leads on Google Maps via Outscraper | 30 leads |
| Diagnoser | ✅ Script ready | Writes briefs + cold messages via Claude Haiku | 30 briefs |
| Checker | ✅ Script ready | 4 local evals + Claude rewrite if needed | Blocks/approves |
| Builder | 🔲 Prompt only | Builds Lovable mockups | 5 sites |
| Filmer | 🔲 Prompt only | Renders 10s vertical video | 5 videos |
| Pitcher | 🔲 Prompt only | Sends outreach by channel | 30 messages |
| Mobile | 🔲 Prompt only | Books calls from replies | Real-time |

---

## Running Scout (Manual Mode)

```bash
# First time setup
npm install

# Step 1 — Scout: find leads (any city, any trade)
node scripts/scout.js --city "Austin, TX" --trade plumber --force

# Step 2 — Diagnoser: generate briefs + cold messages
node scripts/diagnoser.js --force

# Step 3 — Checker: quality-gate messages before sending
node scripts/checker.js --force
```

Supported trades: `plumber`, `hvac`, `electrician`, `roofer`, `handyman`

Scout output: `leads/{city}-{trade}-{date}-run1.json`
Diagnoser output: `queue/{lead_id}-brief.json`

## Cost Controls

Edit `config/scout-config.json`:

```json
{
  "monthly_cap": 10.00,    // Hard stop at $10/mo Outscraper spend
  "auto_run": false,        // false = manual only, true = runs on schedule
  "default_limit": 30       // Results per run
}
```

- `auto_run: false` — Scout only runs when you explicitly call `--force`
- `auto_run: true` — Scout runs normally without `--force` (for scheduled use)
- Budget cap is hard — script exits if monthly spend would exceed cap

---

## Full Setup (when ready to go live)

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Clone: `git clone https://github.com/13dmh33/Website-Master`
3. Copy `.env.local.example` to `.env.local` and fill in keys
4. `cd Website-Master && claude` — Claude Code reads CLAUDE.md
5. When prompted: enter target city and trade

## Required Accounts

| Service | Used By | Status |
|---|---|---|
| Anthropic API | All agents (Claude) | Required |
| Outscraper | Scout | Required — get key at outscraper.com |
| Lovable.dev | Builder | Required |
| Higgsfield.ai | Filmer | Optional (can use Loom manually) |
| Resend or SendGrid | Pitcher (email) | Required |
| Twilio | Pitcher (SMS) | Optional — reuse from Nora |
| Calendly | Mobile | Required |
