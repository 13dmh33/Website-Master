# Miley — Content Engine for Techs4Tatas

## What Miley is

Miley is the automated Instagram content engine for **Techs4Tatas** — a brand making funny, high-quality apparel and merch celebrating women in the skilled trades (plumbing, electrical, HVAC, construction). **30% of every profit funds breast cancer research.**

Miley is a sibling of Milly (Reeve) and Molly (Trevo) — same pipeline architecture, different brand brain. It posts to **@techs4tatas**. The brand voice is **"Riley Brooks"** — warm, funny, scrappy, anonymous (no face reveals, no personal sob-stories; the merch and mission do the talking).

Weekly pipeline: **Researcher → Generator → Designer → Scheduler → Analyst.**

## Active branch

`claude/miley-techs4tatas` (clone of Milly, repurposed for Techs4Tatas). Built for review/testing before merge to `main`.

---

## Review-first workflow (the core operating rule)

**Nothing auto-posts.** With `FORCE_QUEUE=1` (standing setting), every run writes the week to `output/queue/` and builds `output/queue/preview-{weekOf}.html`. Dave reviews, edits if needed, then approves by running `scripts/push-queue.js`, which schedules the week to Buffer at each post's slot time.

- Generation runs **Thursday** for the **following** week → Thu–Sun review window.
- Full routine in `docs/review-workflow.md`.

---

## Agent roster

| Agent | File | Job |
|-------|------|-----|
| Researcher | `agents/researcher.js` | Assembles a zero-API brief from `inspiration-sources.json`: evergreen themes, the seasonal angle, and VERIFIED data hooks (breast-cancer / women-in-trades stats). The Reeve "call for speakers" branch is disabled. |
| Generator | `agents/generator.js` | Resolves the week's plan (planner) and writes ONE post per slot via the brand brain in `agents/generator-prompts.js`. Claude with quality gate → evergreen fallback on any miss. Appends hashtags. |
| Designer | `agents/designer.js` | Renders 1080×1080 PNGs per post via skia-canvas. Product photo background (`assets/products/{key}.png`) when present, else the content-type gradient palette. |
| Scheduler | `agents/scheduler.js` | Queue-first: writes posts + preview. Schedules to Buffer only when `FORCE_QUEUE` is off. |
| Analyst | `agents/analyst.js` | Instagram engagement → updates `brand-voice.json` `what_works` / `top_hashtags`. Skips gracefully without an Instagram token. |

## Library files

| File | Purpose |
|------|---------|
| `lib/store.js` | All I/O abstraction (JSON now, Airtable later). |
| `lib/planner.js` | Resolves campaign mode (base / september / october) → slots → `{format, contentType, product, isOctober, paletteKey}` per post. All rotation logic lives here. |
| `lib/claude.js` | Claude API wrapper (system + user prompt, retry, JSON parse). |
| `lib/glossary.js` | Flattens `trades-glossary.json` categories → 3 trade terms/week injected into prompts. |
| `lib/canvas-render.js` | skia-canvas renderer driven by `visual-config.json` palettes; product-photo + gradient backgrounds; optional drop-in fonts. |
| `lib/buffer.js` | Buffer API v1 — image upload + scheduled post. |
| `lib/instagram-insights.js` | Instagram Graph API (read-only) for the Analyst. |
| `agents/generator-prompts.js` | **The brand brain** — SYSTEM_PROMPT, format/content-type instructions, October overlay, prompt builder, quality gate. |

---

## Content model

### Cadence by month (driven by `post-formats.json` + `october-campaign.json`)
- **Jan–Aug (base):** 4×/week — `TUE:12:00, THU:19:00, SAT:10:00, SUN:18:00`
- **September (ramp):** 5×/week — adds `WED:12:00` (awareness build-up)
- **October (Pink October):** daily (7×/week) — driven by `october-campaign.json` `weekly_rhythm`

Weekdays = community content (humor / motivation / engagement / mission) for reach. Weekends = product/commerce for buying intent. October leans the 30% donation toward the emotional center and shifts cards to the pink **awareness** palette.

### Content types → downstream (in `lib/planner.js`)
`trades_humor · motivational · engagement · mission · product_feature_single · product_feature_lifestyle · product_social_proof · mission_product_combo · awareness_stat · mission_recap`

Each maps to a render format, an evergreen fallback `type`, and a `visual-config` palette key. Product types pull from the 8-item `product_catalog_rotation`.

### Caption formula (every post)
HOOK → SCENE → DONATION (one line, varied) → ONE CTA. Hashtags are appended by the pipeline at posting time (kept out of the caption body), from `hashtag-master.json` (anchors + matching set + October additions).

---

## Templates

| File | Purpose |
|------|---------|
| `brand-voice.json` | Riley voice, formula, donation phrasings, CTA bank, DM keyword (PINK). `what_works`/`top_hashtags` are analyst-owned — don't hand-edit. |
| `post-formats.json` | `current_week` counter, base/september/october schedules, `content_pools`, `product_catalog_rotation`. |
| `evergreen.json` | 36 ready-to-post fallback posts across 5 types. Interchangeable with generated posts (same field shape). |
| `trades-glossary.json` | 44 trade terms across plumbing/electrical/hvac/construction. |
| `hashtag-master.json` | Anchor tags + per-type sets + October additions. |
| `october-campaign.json` | Pink October daily schedule + per-weekday theme/goal + tone shift. |
| `visual-config.json` | Brand colors, fonts, `palettes_by_type`, image-source priority. |
| `inspiration-sources.json` | Evergreen themes, VERIFIED data hooks, news watchlist (paraphrase only — never copy), seasonal angles. |

---

## Running

```bash
cd miley
npm install                      # installs skia-canvas (native) + deps
node scripts/setup.js            # validate env + templates + dirs
node scripts/test-pipeline.js    # full dry run, never posts (free if no API key)

# individual agents
node agents/researcher.js
node agents/generator.js         # uses Claude if ANTHROPIC_API_KEY set, else evergreen
node agents/designer.js
node agents/scheduler.js          # FORCE_QUEUE=1 → review queue + preview
node scripts/push-queue.js        # APPROVAL step: release queue to Buffer at slot times
```

Open `output/queue/preview-{weekOf}.html` in a browser to review the week.

---

## Environment variables

```
ANTHROPIC_API_KEY=             # content generation; blank → evergreen (free)
FORCE_QUEUE=1                  # keep set — review-first, nothing auto-posts
BUFFER_ACCESS_TOKEN=           # CLASSIC token from buffer.com/developers (NOT OIDC — it 401s)
BUFFER_INSTAGRAM_PROFILE_ID=   # GET /1/profiles.json once the token is valid
INSTAGRAM_ACCESS_TOKEN=        # analytics only (Analyst)
INSTAGRAM_BUSINESS_ACCOUNT_ID= # analytics only
INSTAGRAM_HANDLE=@techs4tatas
STOREFRONT_URL=techs4tatas.printify.me
DM_KEYWORD=PINK
# FORCE_EVERGREEN=1            # force evergreen even with an API key (testing)
```

---

## GitHub Actions

Workflows live at repo root: `.github/workflows/miley-weekly-pipeline.yml` (Thu, generates next week) and `miley-weekly-analytics.yml` (Sun night). They only run from `main`, so merge there to activate. Add secrets: `ANTHROPIC_API_KEY`, `BUFFER_ACCESS_TOKEN`, `BUFFER_INSTAGRAM_PROFILE_ID`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`. The pipeline runs scheduler with `FORCE_QUEUE=1` (review-first), commits the rotation counter + content, and uploads `output/` as an artifact.

---

## Hard brand rules (enforced in code + prompts)

- Never offer/imply free product, samples, giveaways, or discount codes.
- Never chase virality/fame/influencer collabs.
- Never do face reveals or personal sob-stories (Riley is anonymous).
- Never stack two CTAs — exactly one.
- Never copy source text — paraphrase facts into brand voice (copyright).
- The quality gate (`generator-prompts.passesQualityGate`) drops any generated post that violates the freebie/donation/length/hashtag rules and falls back to evergreen.

---

## Before going live (Dave's checklist)

- [ ] Confirm/replace placeholder hex in `visual-config.json` with the Canva brand-kit colors.
- [ ] Re-verify breast-cancer stats in `inspiration-sources.json` (figures move yearly).
- [ ] Drop Printify mockups into `assets/products/` (named by catalog key).
- [ ] (Optional) Drop Bebas Neue + Inter `.ttf` into `assets/fonts/` for exact brand match.
- [ ] Buffer **classic** token + Instagram Business profile ID as repo secrets.
- [ ] Keep `FORCE_QUEUE=1` so week one (and every week) lands in the review queue first.
- [ ] Run `node scripts/test-pipeline.js` and review the HTML preview.

## Not yet built / future

- Live news scanning (BLS/ACS/NAWIC) is currently a manual review-time step — paraphrase an idea into the brief. Could be automated later.
- Airtable swap (replace `lib/store.js` internals only).
- Twilio alert when the weekly queue is ready for review.
