# Milly — Content Engine

## What Milly is

Milly is the automated Instagram content engine for the Reeve speaker booking agency. It runs a weekly pipeline: research speaking industry angles → generate 4 posts via Claude → render branded PNG images via skia-canvas → schedule via Buffer.

Milly is internal. It posts to @reeve.agency (Reeve's brand account). No human persona.

## Business flywheel

```
Milly posts 4x/week on Instagram
  → emerging speakers find the content
  → they follow or engage
  → they DM "stages" → Reeve DM agent qualifies them
  → qualified speakers become paying Reeve clients ($597–$997/mo)
```

Every post is a lead gen asset. Each piece of content exists to make an emerging speaker feel the pain of missed opportunities and think "I need Reeve."

## Active branch

`claude/milly-content-engine-qZme3`

---

## Agent roster

| Agent | File | Trigger | Job |
|-------|------|---------|-----|
| Researcher | `agents/researcher.js` | Mon 6am MT | Live SerpApi search for speaking angles + conference CFPs. Falls back to evergreen if search fails. |
| Generator | `agents/generator.js` | Mon 8am MT | Brief → 4 Claude API calls → carousel, caption, reevefound/clarity, reel content. |
| Designer | `agents/designer.js` | Mon 9am MT | Content → PNG images via skia-canvas. Unsplash photos + niche gradient fallback. |
| Scheduler | `agents/scheduler.js` | Tue 6am MT | Images + captions → Buffer API → scheduled Instagram posts. Falls back to /output/queue/. |
| Analyst | `agents/analyst.js` | Sun 10pm MT | Instagram engagement data → updates brand-voice.json with what's working. |

## Library files

| File | Purpose |
|------|---------|
| `lib/store.js` | Data abstraction — all I/O goes through here (JSON today, Airtable later) |
| `lib/claude.js` | Claude API wrapper with JSON parsing and retry logic |
| `lib/canvas-render.js` | skia-canvas rendering helpers — slide layouts, gradient palettes, word wrap |
| `lib/buffer.js` | Buffer API v1 — image upload + scheduled post creation |
| `lib/glossary.js` | Speaking industry terms → seeded into every Claude prompt |
| `lib/ab-tracker.js` | A/B variant tracking for caption hooks |
| `lib/reeve-handoff.js` | High-signal post alerts → `/output/archive/high-signal-[weekOf].json` |
| `lib/instagram-insights.js` | Instagram Graph API — read-only engagement data |

---

## The 4 weekly post formats

| Format | Schedule | Niche | CTA |
|--------|----------|-------|-----|
| Carousel | Tue 7am | booking | DM "stages" |
| Caption | Thu 12pm | mindset / automation / business (rotating) | link in bio |
| Reeve Found / Clarity | Sat 9am | booking | DM "stages" |
| Reel script | Sun 6pm | automation / mindset (alternating) | DM "stages" |

### Caption niche rotation (3-week cycle)
Week 0 → mindset · Week 1 → automation · Week 2 → business → repeats.
Driven by `post-formats.json` `caption_niche_alternation` array. Generator reads `store.getWeekNiches()`.

### Reeve Found vs Service Clarity alternation
- **Odd** `weekNumber` → "Reeve Found This" (real conference deadlines, proof of work)
- **Even** `weekNumber` 0 → "What Reeve Does" (service clarity, retainer model, differentiation from bureaus)
- **Even** `weekNumber` 2 (business caption week) → "What Reeve Costs" (transparent pricing: Scout $97 / Pitch $297 / Full $597)

This means pricing appears approximately once per 3-week content cycle — monthly cadence.

### Reel format
Talking-head, 20 seconds. Hook (2s) + body (12s) + CTA (6s). Direct to camera. No B-roll.

---

## The 4 content pillars

1. **Booking** — getting on stages, pitching to conferences, reading CFPs. Carousel format.
2. **Mindset** — how speakers think: confidence, niche clarity, message precision. Caption format.
3. **Automation** — systematic outreach, CRM discipline, follow-up cadences. Caption/reel format.
4. **Business** — contracts, fee ladders, negotiation, honoraria, retainer model. Caption format.

---

## Speaking glossary

`templates/speaking-glossary.json` — 45 industry-specific terms across 4 niches.

- **booking (12):** bureau, one-sheet, demo reel, kill fee, rider, CFP, RFP, anchor talk, open market vs exclusive, CSP, speaker showcase, NSA
- **business (12):** honorarium, fee ladder, exclusivity clause, travel rider, multi-book discount, referral window, retainer model, speaker IP, spin-off booking, follow-on product, speaker agreement, warm vs cold referral
- **mindset (11):** opening 90 seconds, planted question, talk arc, callback, green room, run of show, hot mic, tech check, clicker, stage fright vs performance anxiety, Q&A trap
- **automation (10):** prospect list, pipeline, CRM for speakers, follow-up cadence, pitch template, decision maker mapping, conference calendar, outreach sequence, booking funnel, conference research tools

`lib/glossary.js` picks 2-3 terms per week, formats them for Claude injection. Researcher also seeds angle ideas from glossary terms per niche.

---

## Image design system

### Primary: Unsplash photos + dark overlay
- Fetched at runtime via `UNSPLASH_ACCESS_KEY`
- Query per niche (e.g. `booking` → "conference stage spotlight", "keynote speaker podium")
- Dark overlay `rgba(8,15,30,0.62)` for text legibility + bottom grounding gradient
- **Blocked from container** — Unsplash API only works from Mac

### Fallback: niche-specific gradient backgrounds (always works)
6 editorial palettes in `DESIGN_CONFIG` (all in `lib/canvas-render.js`):

| Niche | Palette mood |
|-------|-------------|
| `booking` | Dark navy, warm amber off-center spotlight, teal rim |
| `carousel` | Deep charcoal, purple-indigo overhead, teal rim |
| `mindset` | Deep ocean blue, cool horizon sunrise |
| `automation` | Near-black, cyan grid, tech glow |
| `reevefound` | Chandelier amber on dark navy |
| `reel` | Theatre black, white overhead spotlight |
| `business` | Dark charcoal, gold boardroom glow, teal rim |

### Design constants (`DESIGN_CONFIG`)
```javascript
overlay:       'rgba(8, 15, 30, 0.62)'
headline:      '#FFFFFF'
accent:        '#1DA884'  // teal
body:          '#E2E8F0'
headlineSize:  56px
brandSize:     20px   // "REEVE" wordmark
padding:       72px
```

---

## The store.js abstraction pattern

All agents use `store.js`. No agent calls `fs` directly or touches Airtable directly.

```javascript
// agents do this:
const store = require('../lib/store');
const brief = store.getLatestBrief();
store.saveBrief({ weekOf: '2026-06-09', ... });

// agents never do this:
const fs = require('fs');
const brief = JSON.parse(fs.readFileSync('./output/briefs/brief-2026-06-09.json'));
```

To swap to Airtable: change only `lib/store.js`. Agent code is untouched.

---

## Running agents

```bash
cd milly

# Validate environment
node scripts/setup.js

# Full pipeline, no posting (dry run)
node scripts/test-pipeline.js

# Individual agents
node agents/researcher.js
node agents/generator.js
node agents/designer.js
node agents/scheduler.js   # run on Mac — Buffer API blocked from container
node agents/analyst.js

# Post everything in the manual queue (run on Mac)
node scripts/push-queue.js
```

---

## Environment variables

```
# Required
ANTHROPIC_API_KEY=          # all content generation

# Posting (Buffer — run on Mac)
BUFFER_ACCESS_TOKEN=        # classic token from buffer.com/developers (NOT OIDC token)
BUFFER_INSTAGRAM_PROFILE_ID= # get via GET /profiles.json once token is valid

# Live research
SERPAPI_KEY=                # otherwise evergreen fallback always used

# Images
UNSPLASH_ACCESS_KEY=        # editorial photos; falls back to gradients if missing/blocked

# Analytics
INSTAGRAM_ACCESS_TOKEN=              # Graph API read-only
INSTAGRAM_BUSINESS_ACCOUNT_ID=      # numeric account ID

# Notifications
DAVE_NOTIFY_EMAIL=          # optional — high-signal post alerts
```

**Buffer token note:** Buffer API v1 requires a classic access token from `buffer.com/developers → Create App → Generate Access Token`. OIDC tokens from the Buffer MCP integration page return 401 and will not work.

---

## What's built (current state, 2026-06-05)

### Core pipeline (all ✅)
- Researcher with live SerpApi + evergreen fallback
- Generator: carousel, caption, reevefound/clarity, reel — all with sharp prompts and glossary injection
- Designer: Unsplash photos + niche gradient fallbacks; niche passthrough from generator
- Scheduler: Buffer API v1 (replaced PostPeer which had no Instagram support)
- Analyst: engagement tracking + brand-voice.json updates

### Speaking expertise upgrades (all ✅)
- **Speaking glossary:** 45 terms, injected into every Claude call via `lib/glossary.js`
- **Business niche pillar:** 3rd caption rotation week (contracts, fees, negotiation)
- **Talking-head reel format:** direct to camera, stacked evidence, no B-roll
- **Service clarity rotation:** alternates "Reeve Found This" (odd weeks) / "What Reeve Does" (even weeks) / "What Reeve Costs" (business week)
- **CTA diversity:** `buildOutboundCta(weekNumber)` alternates "DM stages" (even weeks) with "DM audit" (odd weeks) on reel and clarity posts; carousel always uses stages (high-intent audience)
- **Pricing transparency post:** `generatePricingClarity()` runs on business-niche clarity weeks; names Scout/Pitch/Full tiers and prices directly
- **Client result evergreen posts:** ev-11 (first booking story) and ev-12 (90-day pipeline story) — social proof before real case studies exist
- **Evergreen bank expanded:** 36 total posts (ev-01 through ev-36); covers 9 weeks of fallback content across all 4 pillars (booking, mindset, automation, business). Posts include: fee-setting framework, one-sheet strategy, how to read a CFP, niche clarity, imposter syndrome, opening 90 seconds, minimal CRM setup, 2-hour pipeline schedule, conference calendar mapping, kill fees, fee ladder mechanics, rejection-as-data, batch research day, speaker agreements (5 clauses), speaker showcases, education/association CFPs, fee confidence, pitch acceptance rate tracking, 3-touch follow-up sequence, saying no to misfit gigs, verbal vs written confirmation, ROI framing for organizers

### A/B and analytics (built, pending data)
- Caption A/B variants via `lib/ab-tracker.js` (2 hooks/week, same angle)
- Hashtag performance tracking in `brand-voice.json`
- Content archive pattern analysis after 4+ weeks of data
- `lib/reeve-handoff.js` — fires when profile visits >2x average; consumed by `reeve/scripts/check-high-signal.js` (see "Reeve handoff" below)

---

## Activation checklist (pending)

### Local (.env)
1. **Buffer access token** — Create App at `buffer.com/developers` → Generate Access Token → add to `.env`
2. **Buffer profile ID** — `curl https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN` → find the Instagram profile → copy the `id`
3. **SerpApi key** — add to `.env` to enable live research; without it, evergreen fallback runs every week
4. **Unsplash key** — add to `.env` on Mac; container always uses gradient fallback

### GitHub Actions (required for automated weekly runs)
Workflows are in `.github/workflows/`. They only trigger from the default branch (`main`).
**Steps to activate:**
1. Add secrets in GitHub repo → Settings → Secrets and variables → Actions:
   - `ANTHROPIC_API_KEY`
   - `BUFFER_ACCESS_TOKEN` (classic token, NOT OIDC)
   - `BUFFER_INSTAGRAM_PROFILE_ID`
   - `SERPAPI_KEY` (optional — evergreen fallback if missing)
   - `UNSPLASH_ACCESS_KEY` (optional — gradient fallback if missing)
   - `INSTAGRAM_ACCESS_TOKEN` (for analytics only)
   - `INSTAGRAM_BUSINESS_ACCOUNT_ID` (for analytics only)
2. Merge `claude/milly-content-engine-qZme3` → `main`
3. Scheduled workflows activate automatically. Use `workflow_dispatch` to test manually.

---

## Common failure modes

**Researcher falls back to evergreen every week**
SerpApi key not configured. Add `SERPAPI_KEY` to `.env`.

**Generator returns invalid JSON**
`lib/claude.js` strips markdown fences before parsing. If still failing, the raw Claude response is logged — usually means max_tokens was hit. Increase in `generator.js`.

**Designer renders flat dark background instead of photo**
Expected behavior when `UNSPLASH_ACCESS_KEY` is missing or when running from container (Unsplash API is blocked). Niche gradient is the designed fallback.

**Scheduler falls back to /output/queue/**
Buffer not configured or token invalid. Check `.env`. Run `node scripts/push-queue.js` on Mac to post manually.

**Buffer returns 401 "OIDC tokens not accepted"**
Wrong token type. Get a classic access token from `buffer.com/developers`, not from the Buffer MCP page.

**"— Reeve" appears twice in captions**
Fixed. Generator strips existing attribution from `prc.body` with regex before appending. If re-emerging, check the evergreen post's `body` field for the attribution string.

**Analyst skips with "not configured"**
Normal when `INSTAGRAM_ACCESS_TOKEN` is not set. Add token to enable analytics feedback loop.

---

## File structure

```
milly/
  CLAUDE.md
  README.md
  package.json
  .env.example
  agents/
    researcher.js         # Mon 6am — brief generation
    generator.js          # Mon 8am — 4 posts via Claude
    designer.js           # Mon 9am — PNG rendering
    scheduler.js          # Tue 6am — Buffer scheduling (run on Mac)
    analyst.js            # Sun 10pm — engagement feedback loop
  lib/
    store.js              # all I/O abstraction
    claude.js             # Claude API wrapper
    canvas-render.js      # image rendering (skia-canvas)
    buffer.js             # Buffer API v1
    glossary.js           # speaking terms → Claude prompt injection
    ab-tracker.js         # caption A/B tracking
    reeve-handoff.js      # high-signal post alerts
    instagram-insights.js # Graph API read-only
    postpeer.js           # deprecated — keep for reference only
  templates/
    brand-voice.json      # Reeve voice config + analyst feedback
    post-formats.json     # format specs + weekly rotation counter
    inspiration-sources.json  # content inspiration themes
    speaking-glossary.json    # 45 industry terms
    evergreen.json        # 10+ backup posts
  cron/
    weekly-pipeline.yml   # GitHub Actions: Mon 6am MT
    weekly-analytics.yml  # GitHub Actions: Sun 10pm MT
  output/
    briefs/               # weekly research briefs
    content/              # generated post content
    images/               # rendered PNGs
    queue/                # manual posting queue + preview HTML
    archive/              # completed weeks + pattern analysis
  scripts/
    setup.js              # env var validation
    push-queue.js         # manual queue posting (run on Mac)
    test-pipeline.js      # full dry run, no posting
    generate-evergreen.js # generate evergreen batch via Claude
```

## Reeve handoff ✅ BUILT

Reeve has no automated outbound DM campaign to "increase volume" on — the DM agent only
responds to inbound `stages` triggers — so the real handoff is alerting Dave to a 3-day
manual-outreach window. `reeve/scripts/check-high-signal.js` reads
`milly/output/archive/high-signal-*.json` (Milly and Reeve are sibling directories in the
same monorepo checkout, so no live webhook is needed) and emails Dave via the same
Zoho/nodemailer pattern `dm-agent.js` uses, then marks entries `reeveNotifiedAt` so they
aren't re-sent. Wired into `.github/workflows/milly-weekly-analytics.yml` right after
`analyst.js` runs, so the handoff happens within the same CI job. `--dry-run` flag available.
Needs `ZOHO_EMAIL` / `ZOHO_APP_PASSWORD` / `DAVE_NOTIFY_EMAIL` secrets set — without them it
logs to console only and leaves entries unmarked, so they retry every run once secrets are added.

## Phase 2 items (not yet built)

1. **Twilio alerts** — SMS to Dave when Scheduler or Analyst completes
2. **Airtable swap** — replace local JSON with Airtable in `lib/store.js`; no agent changes
3. **A/B visual testing** — swap overlay opacity and/or NICHE_PALETTES for design experiments
4. **Stories format** — vertical (1080x1920) behind-the-scenes content
