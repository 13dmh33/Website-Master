# Milly — full code and product overview

Written for review by an external/different-use-case audience. Covers what Milly does, how it's built, and what would need to change to repurpose it.

---

## 1. Product summary

Milly is an automated Instagram content engine. It runs a weekly pipeline — research → write → render → schedule — and posts 4x/week to a single Instagram Business account with zero manual content work, beyond setup. It was built for **Reeve**, a speaker-booking agency, to feed a lead-gen flywheel:

```
Milly posts 4x/week on Instagram
  → target audience sees content, follows/engages
  → DMs a keyword
  → a separate DM-qualifier agent (Reeve) scores and routes them
  → qualified leads become paying clients
```

Milly itself has no opinion about who the audience is — that's encoded entirely in its config files (brand voice, glossary, niches, evergreen bank). The pipeline logic, rendering, and scheduling are domain-agnostic.

**Cost profile:** 4 Claude API calls/week (content generation) + optional SerpApi (research) + optional Unsplash (images) + Buffer (free tier, 3 channels). No paid infrastructure required beyond the LLM call and a place to run cron (GitHub Actions, used here, is free).

---

## 2. Architecture

Five agents run in sequence once a week, each reading the previous agent's output from disk and writing its own:

```
Researcher  (Mon 6am) → output/briefs/brief-{date}.json
Generator   (Mon 8am) → output/content/content-{date}.json
Designer    (Mon 9am) → output/images/{date}/*.png
Scheduler   (Tue 6am) → Buffer API (or output/queue/ fallback)
Analyst     (Sun 10pm)→ updates templates/brand-voice.json
```

No agent calls another directly — they're decoupled by the filesystem (via a storage abstraction, see below) and run as separate `node` processes on a cron schedule. This means any single agent can be re-run, replaced, or tested in isolation.

### Storage abstraction — `lib/store.js`

Every agent reads/writes through `store.js` instead of touching `fs` directly. It currently persists to local JSON files (`output/briefs/`, `output/content/`, `output/queue/`, `output/archive/`), but the module boundary means swapping to a database (Airtable was the original plan; Postgres/Supabase would work the same way) only requires changing this one file — zero changes to agent code. This is the same pattern used in the sibling Trevo/Reeve projects in this repo (`scripts/state-store.js`, `reeve/lib/client-store.js`).

Key functions: `saveBrief`/`getLatestBrief`, `savePost`/`getLatestContent`/`updatePostStatus`, `saveToQueue`/`getPendingQueue`/`markQueuePosted`, `getBrandVoice`/`updateBrandVoice`, `getUnusedEvergreen`/`markEvergreenUsed`, `getWeekNiches`/`advanceWeekRotation`.

### Claude wrapper — `lib/claude.js`

Single chokepoint for all LLM calls (model: `claude-sonnet-4-20250514`). Handles auth, one automatic retry with backoff on transient failure, and JSON parsing that strips markdown code fences. No agent calls the Anthropic SDK directly — this is where you'd add rate limiting, cost tracking, or swap models/providers for a different deployment.

---

## 3. The five agents in detail

### Researcher (`agents/researcher.js`, 240 lines)
Builds the weekly content brief. Tries live search first (SerpApi, optional), looking for conference CFP ("call for speakers") signals via regex pattern matching on search result titles/snippets. Falls back to a curated "recurring themes" list (`templates/inspiration-sources.json`) if no API key is set or the search fails — so the pipeline never blocks on a missing key. Computes the current Monday's date and saves a brief keyed to that week.

### Generator (`agents/generator.js`, 394 lines)
The core content-writing agent. Makes up to 4 separate Claude calls — one per post format — each with its own prompt built from: the brief, a brand-voice config, a rotating speaking-industry glossary (2-3 terms injected per call), and the current week's niche assignment. Produces structured JSON per post (caption, hook, body, CTA) which `claude.parseJson` validates. Falls back to the evergreen bank (36 pre-written posts) if generation fails or budget/quality checks don't pass.

### Designer (`agents/designer.js`, 119 lines)
Renders each post's caption/headline into a branded 1080x1080 PNG using `skia-canvas` (server-side canvas, no headless browser). Two render paths:
- **Primary:** fetch a stock photo from Unsplash matching the niche, apply a dark overlay (`rgba(8,15,30,0.62)`) for text legibility, draw headline/body/wordmark on top.
- **Fallback (always available):** a niche-specific gradient background (6 hand-tuned palettes in `lib/canvas-render.js`'s `DESIGN_CONFIG`) — used automatically when Unsplash is unreachable or unconfigured. Verified working in a network-restricted container with zero external calls.

### Scheduler (`agents/scheduler.js`, 241 lines)
Takes the week's 4 posts and a `POST_SCHEDULE` config (default `TUE:07:00,THU:12:00,SAT:09:00,SUN:18:00`, timezone-aware), computes the next occurrence of each slot, and either:
- **Primary:** calls Buffer's API (`lib/buffer.js`) to upload the image and create a scheduled Instagram post, or
- **Fallback:** writes the post to `output/queue/` as JSON for manual posting (`scripts/push-queue.js`) — automatically used if Buffer isn't configured, or per-post if an individual Buffer call fails.

Also generates a dark-themed HTML preview (`output/queue/preview-{date}.html`) embedding base64 images so the full week can be reviewed in a browser before anything goes live. Supports `--dry-run` (logs what would be scheduled, makes zero API calls or file writes) and `FORCE_QUEUE=1` (forces queue-only mode even if Buffer is configured, e.g. for review-before-send workflows).

### Buffer API client (`lib/buffer.js`, 123 lines)
Thin wrapper over Buffer's classic v1 REST API (free tier, 3 connected channels). Uploads images via Node 18's built-in `FormData`/`fetch` (no extra dependency), looks up the Instagram profile ID once and caches it, and posts via `updates/create.json` with a `scheduled_at` timestamp. Important operational note: Buffer v1 requires a **classic** OAuth access token from `buffer.com/developers` — the newer OIDC token from Buffer's MCP integration page returns 401 and silently won't work. This is documented prominently because it's the single most likely setup mistake.

### Analyst (`agents/analyst.js`, 206 lines)
Runs separately (Sunday night) via Instagram's Graph API (read-only) to pull engagement data on the past week's posts, classifies each post's format/niche from its caption text (keyword heuristics), and after 4+ weeks of accumulated data, asks Claude to identify which formats/niches/times perform best. Writes findings into `brand-voice.json`'s `what_works`/`top_hashtags` (rolling 8-entry window) so future Generator runs are informed by real performance — a closed feedback loop. Gracefully no-ops if `INSTAGRAM_ACCESS_TOKEN` isn't set.

---

## 4. Content model

Four weekly post formats, each on a fixed day/format pairing:

| Format | Day | Niche source | CTA |
|---|---|---|---|
| Carousel | Tue | fixed niche (booking, in Reeve's case) | "DM keyword" |
| Caption | Thu | rotates through a 3-item list (3-week cycle) | link in bio |
| Themed/proof post | Sat | alternates between two sub-formats by week parity | "DM keyword" |
| Reel script | Sun | alternates between two niches | "DM keyword" |

The rotation state lives in `templates/post-formats.json` as a single incrementing counter (`current_week`), advanced once per run, modulo the rotation array length — adding a 4th or 5th niche to the cycle requires no code change.

**A/B testing:** `lib/ab-tracker.js` alternates two caption-hook variants weekly and tracks them — built but currently pending enough data to be useful (needs 8+ weeks).

**Evergreen bank:** `templates/evergreen.json` holds a pre-written content bank (36 posts in Reeve's case) used whenever live generation fails, an API key is missing, or as a deliberate fallback — guarantees the pipeline can never produce zero output for a week.

**Glossary injection:** `lib/glossary.js` holds a domain-specific term list (45 terms across 4 categories in Reeve's case), picks 2-3 per week, and feeds them into every Generator prompt to keep language credible/specific rather than generic AI copy. This is the main per-vertical customization point.

---

## 5. Repurposing for a different use case

To point Milly at a different brand/audience, the only things that need to change are config and prompt content — not pipeline code:

| What to change | File(s) |
|---|---|
| Brand voice, tone, what's-working data | `templates/brand-voice.json` |
| Post format schedule + niche rotation | `templates/post-formats.json` |
| Domain glossary / vocabulary | `templates/speaking-glossary.json` (rename/replace) + `lib/glossary.js` |
| Fallback content bank | `templates/evergreen.json` |
| Content angle seeds | `templates/inspiration-sources.json` |
| Visual palette per niche | `lib/canvas-render.js` → `DESIGN_CONFIG` / `NICHE_PALETTES` |
| Posting schedule | `POST_SCHEDULE` env var |
| Generator prompts (the actual writing instructions) | `agents/generator.js` — this is the one place with real prose to rewrite per-vertical |

Nothing in `lib/store.js`, `lib/claude.js`, `lib/buffer.js`, or the scheduler/designer rendering logic is Reeve-specific. A second brand could run as a sibling directory with its own `.env`, `templates/`, and cron schedule, sharing the same `lib/` if extracted to a shared package — currently it's a self-contained directory, so the simplest repurposing path is "copy the `milly/` directory, replace `templates/` and `agents/generator.js` prompts, point at a different Buffer profile ID."

---

## 6. Operational status (as of this writing)

- **Built and tested:** full pipeline runs end-to-end. Gradient-fallback rendering confirmed working without network access. `scheduler.js --dry-run` confirmed correct output without any Buffer calls.
- **Live and automated:** GitHub Actions cron is active on `main` — Monday 6am MT full pipeline (researcher → generator → designer → scheduler), Sunday 10pm MT analytics. Workflow auto-commits the rotation counter + generated output back to `main` after each run.
- **Blocking real posting:** `BUFFER_ACCESS_TOKEN` / `BUFFER_INSTAGRAM_PROFILE_ID` not yet set as repo secrets — until then, every week's content lands safely in `output/queue/` with an HTML preview instead of actually posting. See `milly/MILLY_SETUP.md` for the ~20-minute activation steps.
- **Optional, not blocking:** `SERPAPI_KEY` (live research vs. evergreen fallback), `UNSPLASH_ACCESS_KEY` (photo vs. gradient backgrounds), `INSTAGRAM_ACCESS_TOKEN` (analytics feedback loop).

---

## 7. File map

```
milly/
  agents/
    researcher.js    240 lines — brief generation (live search + evergreen fallback)
    generator.js     394 lines — 4 Claude calls → structured post JSON
    designer.js       119 lines — skia-canvas PNG rendering (photo or gradient)
    scheduler.js      241 lines — Buffer scheduling + queue fallback + HTML preview
    analyst.js         206 lines — engagement feedback loop
  lib/
    store.js           270 lines — all I/O (swap-the-backend abstraction)
    claude.js            82 lines — Anthropic SDK wrapper (auth, retry, JSON parse)
    buffer.js           123 lines — Buffer API v1 client
    canvas-render.js    368 lines — rendering primitives, palettes, word wrap
    glossary.js          59 lines — vocabulary injection for prompts
    ab-tracker.js        51 lines — caption A/B variant rotation
    reeve-handoff.js     44 lines — high-signal post alert stub
    instagram-insights.js 108 lines — Graph API read-only client
    postpeer.js         105 lines — deprecated (kept for reference; replaced by Buffer)
  templates/
    brand-voice.json, post-formats.json, inspiration-sources.json,
    speaking-glossary.json, evergreen.json
  scripts/
    setup.js              — env var validation
    test-pipeline.js       — full dry run (research → generate → render → queue, never posts)
    push-queue.js          — posts everything in output/queue/ to Buffer (run on Mac)
    generate-evergreen.js  — batch-generates the evergreen bank via Claude
  output/   (runtime — briefs/, content/, images/, queue/, archive/)
  cron/     (reference copies of the GitHub Actions workflow YAML)
```

Total agent + lib + script code: ~2,800 lines, no test suite or linter currently configured (flagged separately as a gap, not specific to Milly).
