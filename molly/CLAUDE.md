# Molly — Content Engine for Trevo Advisors

## What Molly is

Molly is the automated Instagram/LinkedIn content engine for **Trevo Advisors** — Trevo's own brand account, not a client's. It runs the same weekly pipeline shape as Milly (Reeve) and Miley (Techs4Tatas): research → generate → design → schedule → analyze. Molly is internal — it posts to **@trevoadvisors**. No human persona; copy is signed "— Trevo".

Molly's job is to build organic audience and inbound demand among home-service contractors (plumbing, electrical, handyman, roofing) so Trevo's outbound (Scout/Diagnoser/Pitcher pipeline) isn't the only lead source.

## Business flywheel

```
Molly posts 4x/week on Instagram/LinkedIn
  → contractors see proof of work (real demos, gap-score education)
  → they DM "demo" or click link in bio
  → inbound lead enters the same Trevo pipeline as outbound Scout leads
```

Every post either teaches a contractor their online-presence gap or shows proof Trevo closed one. **HVAC appears in content sourcing only** (`templates/sources.json` includes HVAC alongside plumbing/electrical/handyman) — Molly does not pitch or target HVAC contractors directly, consistent with the root HVAC exclusion (owner conflict of interest).

## Status

Built and merged to `main`. Agents run from root `package.json`/cron equivalent to Milly's GitHub Actions pattern (no dedicated `cron/` dir yet — see Gaps below).

---

## Agent roster

| Agent | File | Job |
|-------|------|-----|
| Researcher | `agents/researcher.js` | Pulls content angles from `templates/sources.json` (200 curated trade sources — news/business/humor/regulatory across HVAC/plumbing/electrical/handyman) + contractor glossary terms. Evergreen fallback if live research unavailable. |
| Generator | `agents/generator.js` | Brief → Claude → carousel, caption, `trevo_found`, reel script. HVAC explicitly excluded from generated targeting/copy. |
| Designer | `agents/designer.js` | Content → PNG via skia-canvas, same rendering pattern as Milly/Miley. |
| Scheduler | `agents/scheduler.js` | Images + captions → Buffer (or manual queue fallback). |
| Analyst | `agents/analyst.js` | Engagement data → updates `brand-voice.json` `what_works`. |

## Library files

| File | Purpose |
|------|---------|
| `lib/store.js` | All I/O abstraction (JSON now, swappable later — same pattern as Milly/Miley). |
| `lib/claude.js` | Claude API wrapper with JSON parsing + retry. |
| `lib/canvas-render.js` | skia-canvas rendering — slide layouts, palettes, word wrap. |
| `lib/buffer.js` | Buffer API v1 — image upload + scheduled post creation. |
| `lib/glossary.js` | Contractor/trade terms → seeded into Claude prompts. |
| `lib/ab-tracker.js` | Caption A/B variant tracking. |
| `lib/sources.js` | Reads `templates/sources.json` for live angle sourcing. |
| `lib/instagram-insights.js` | Instagram Graph API — read-only engagement data. |

---

## The 4 weekly post formats (`templates/post-formats.json`)

| Format | Schedule | Niche | CTA |
|--------|----------|-------|-----|
| Carousel | Tue 7am | education | "DM us the word demo" |
| Caption | Thu 12pm | results / education (alternates weekly) | link in bio |
| Trevo Found | Sat 9am | product — proof of work, real demo/site launch, never names specific clients | "DM us the word demo" |
| Reel | Sun 6pm | results / journey (alternates weekly) | "DM us the word demo" |

Weekly rotation tracked via `post-formats.json` → `weekly_rotation.current_week`. Caption alternates `results → education → journey`; reel alternates `results → journey`.

### Reel format
20-second script: hook (2s) + body (12s) + CTA (6s), with inline b-roll notes. Image type is a quote-card of just the hook line.

---

## Content sourcing

`templates/sources.json` — 200 curated sources tagged by trade (HVAC/plumbing/electrical/handyman/multi), category (news/business/humor/regulatory), and platform (website/YouTube/Instagram). This is Molly's raw material for the Researcher; it is broader than what Molly is allowed to target (HVAC sourcing is fine for general trade-industry color, but no HVAC-targeted pitch content is generated — enforced in `generator.js`).

`templates/contractor-glossary.json` — trade/business terms (e.g. "gap score") seeded into prompts to make posts feel credible to tradespeople, same pattern as Milly's speaking glossary and Miley's trades glossary.

---

## Brand voice (`templates/brand-voice.json`)

- **Handle:** @trevoadvisors
- **Audience:** home service contractors without a professional site, or losing jobs to competitors who have one
- **Core pain:** "most contractors lose 3-5 jobs per week to competitors with better online presence — a professional website closes that gap in 48 hours"
- **Tone:** direct, results-focused, credible, never salesy

---

## Running agents

```bash
cd molly

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

Same shape as Milly (`milly/CLAUDE.md`):

```
ANTHROPIC_API_KEY=           # all content generation
BUFFER_ACCESS_TOKEN=         # classic token, NOT OIDC — run on Mac
BUFFER_INSTAGRAM_PROFILE_ID=
UNSPLASH_ACCESS_KEY=         # optional, falls back to gradients; blocked from container
INSTAGRAM_ACCESS_TOKEN=      # Graph API read-only, for Analyst
INSTAGRAM_BUSINESS_ACCOUNT_ID=
DAVE_NOTIFY_EMAIL=           # optional
```

---

## Gaps / known TODOs

- No `cron/` GitHub Actions workflow yet (Milly and Miley both have scheduled cron — Molly currently relies on manual runs or root-level scheduling not yet wired).
- No `output/` runtime directory checked in yet (created on first run, same as Milly/Miley).
- No standalone `README.md` (Milly and Miley both have one).
