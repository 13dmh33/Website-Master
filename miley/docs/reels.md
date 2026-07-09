# Reels — Techs4Tatas / Miley

The reels engine turns a short **script** into a finished, faceless, vertical
**1080×1920 `.mp4`** — the actual postable Instagram Reel, not just a cover. It
runs inside the normal weekly pipeline (Generator → Designer → Scheduler),
review-first, at **$0 marginal cost** (skia-canvas + a bundled static ffmpeg;
no APIs, no stock footage, no music fees).

- Partner-facing overview page: [`reels-overview.html`](reels-overview.html)
- Example clips: [motivational](reels-example-motivational.mp4) ·
  [mission](reels-example-mission.mp4) · [product](reels-example-product.mp4)

---

## Two things rotate independently

Each reel is chosen along two axes, so the feed stays varied on both look and message.

### 1. Visual style — `post-formats.json` → `reel_styles`
| Style | What it looks like |
|-------|--------------------|
| `card` | One bold statement per beat over a slow Ken Burns push-in. Calm, brand-forward. |
| `kinetic_karaoke` | Words reveal one at a time **in place** (frozen layout, no reflow); the active/strongest word is lit in the accent color. The caption style that holds thumbs. |
| `kinetic_punch` | One big word at a time, full-screen. Fast, high-energy, made for the first two seconds. |

### 2. Content theme — `post-formats.json` → `reel_content_rotation`
| Theme | What it's about |
|-------|-----------------|
| `motivational` | Grit and pride — lines a tradeswoman stops for and tags a friend on. |
| `mission` | The 30% — breast cancer research, said plainly and often. |
| `product_feature_lifestyle` | The merch — pulls a catalog product and renders over its real photo (`assets/products/<key>.png`) when present. |

Both lists are config-only — reorder or trim (e.g. a 2-way style test, or drop
products) with no code change. The planner advances each rotation per reel
week, uniform across the week.

---

## How it works (all $0, CPU + bundled ffmpeg only)

```
script (beats)  →  render frames (skia)  →  stitch to .mp4 (ffmpeg)  →  grade + grain  →  review queue
```

- **Script → beats.** Each reel carries a 3–5 beat script in `post.extra`, one
  line per beat: `Beat 1: ON-SCREEN TEXT || spoken voiceover`. The strongest
  word is wrapped in `*asterisks*` to highlight it. Evergreen reels with no
  script synthesize beats from hook/body/cta.
- **Frames.** `card` renders one 1080×1920 frame per beat; `kinetic` renders one
  frame per word-reveal state, in the real brand fonts (Bebas Neue) and palette,
  with a Stories-style segmented progress bar (never a carousel counter).
- **Video.** `card` uses per-beat varied motion + beat-synced cuts; `kinetic`
  holds each word state for its own duration via ffmpeg's concat demuxer
  (frame-accurate). Both get a filmic grade + moving film grain so it reads shot,
  not exported.
- **Silent by design** (brand rule: no licensed music) — ships with a null audio
  track so Buffer/Instagram accept it; add trending audio in-app.
- **Review-first** — nothing auto-posts; the reel lands in the weekly preview
  (`output/queue/preview-*.html`) with a playable `<video>` to approve.

**Code:** `lib/reel.js` (parse/build/assemble), `lib/canvas-render.js`
(`renderReelFrame`, `renderReelWordFrame`), `agents/designer.js` (dispatch on
`post.reel_style`), `lib/planner.js` (both rotations), `agents/scheduler.js`
(preview + label).

---

## Full example reels

Each block is a complete reel exactly as the engine represents it: the `extra`
script (what burns on screen), the posted caption, and hashtags. `*word*` marks
the highlighted word. Rendered output linked per example.

### Example 1 — Motivational · `card` · ▶ [reels-example-motivational.mp4](reels-example-motivational.mp4)

**Script (`extra`):**
```
Beat 1: Be the woman the *next girl* points to || warm slow push on mentor + apprentice
Beat 2: She is watching how you *carry* it || cut to hands on a tool
Beat 3: Show her it is *possible* || apprentice smiles
Beat 4: Then show her *how* || end card, logo
```
**Caption:**
> Be the woman the next girl points to.
>
> Somewhere there's an apprentice watching how you carry it. Show her it's possible. Then show her how.
>
> 30% of every profit funds breast cancer research.
>
> Save this for the hard days 🩷

**Hashtags:** `#techs4tatas #womenintrades #tradeswomen #womenwhobuild #mentorship`

---

### Example 2 — Mission · `kinetic_karaoke` · ▶ [reels-example-mission.mp4](reels-example-mission.mp4)

**Script (`extra`):**
```
Beat 1: This is not just *merch* || product flat-lay, slow zoom
Beat 2: 30% of profit funds *research* || pink accent hit
Beat 3: Funded by women who *build* it || jobsite montage
Beat 4: Wear it. Fund it. *Pass it on* || end card, logo
```
**Caption:**
> This isn't just merch.
>
> Every order sends 30% of profit to breast cancer research — funded by the women who build everything else.
>
> Wear it. Fund it. Pass it on.
>
> Shop the link in bio 🩷

**Hashtags:** `#techs4tatas #breastcancerawareness #womenintrades #shopwithpurpose #30percent`

---

### Example 3 — Product · `kinetic_punch` · over the snapback photo · ▶ [reels-example-product.mp4](reels-example-product.mp4)

**Script (`extra`):** (product `snapback_hat` → renders over `assets/products/snapback_hat.png`)
```
Beat 1: Built for the *jobsite* || snapback on a workbench, push in
Beat 2: Not the *gym* || quick cut
Beat 3: It earns its *dirt* || close on the patch
Beat 4: Link in *bio* || end card, logo
```
**Caption:**
> Built for the jobsite, not the gym.
>
> Structured snapback, breathable mesh, and a patch that earns its dirt. 30% of profit funds breast cancer research.
>
> Grab yours — link in bio.

**Hashtags:** `#techs4tatas #tradeswomen #snapback #womenintrades #shopsmall`

---

## The rotation in practice (base cadence)

Reels land on the Thursday slot on even weeks; both axes advance per reel week:

| Week | Theme | Style | Product |
|------|-------|-------|---------|
| 0 | motivational | card | — |
| 2 | product | kinetic_punch | snapback_hat |
| 4 | mission | kinetic_karaoke | — |
| 6 | motivational | card | — |

---

## Status & next

- Built and verified end-to-end; **29 automated checks passing**.
- On branch `claude/tatas-reels-tech-gv5khk`.
- **Next:** connect the posting account (Buffer) and let the Analyst score which
  style/theme earns the most engagement (persisted per reel; blocked only on
  live Instagram insights — the same gap the caption A/B loop has today).
