# Reels — Trevo Advisors / Molly

The reels engine turns a short **script** (hook/body/cta) into a finished,
vertical **1080×1920 `.mp4`** — the actual postable Instagram Reel, not just a
cover image. It runs inside the normal weekly pipeline (Generator → Designer →
Scheduler), review-first, at **$0 marginal cost** (skia-canvas + a bundled
static ffmpeg; no APIs, no stock footage, no music fees).

Ported from Miley's (Techs4Tatas) reels engine — the underlying `lib/reel.js`
module is brand-agnostic and unchanged; only the rendering (`lib/canvas-render.js`
reel-frame functions) and content shape are Trevo-specific.

---

## Reel content is 3 beats, not a timestamped script

Molly's reel used to be a single narrated "Hook (0-2s) / Body (2-14s) / Cta
(14-20s)" voiceover script rendered as one static thumbnail. It's now three
short **on-screen** lines — `hook`, `body`, `cta` — each its own beat in the
finished reel:

```json
{
  "hook": "Same contractor. Same trade. *One* thing changed.",
  "body": "He was running on referrals — solid, with a ceiling.",
  "cta":  "DM us the word demo. — Trevo",
  "caption": "Same contractor. Same trade. One thing changed.\n\nHe was running on referrals..."
}
```

`caption` is the separate Instagram caption text — never the on-screen lines
verbatim. One word per beat may be wrapped in `*asterisks*` to mark it as the
emphasized/accent-colored word (optional, at most one per beat).

`lib/reel.js`'s `parseBeats()` builds beats straight from `hook`/`body`/`cta`
(no `extra` script field needed for Molly) via its `synthesizeBeats` fallback
path — the same function Miley uses when an evergreen reel has no script.

---

## One thing rotates: visual style

Unlike Miley (which also rotates a content theme independently), Molly's reel
slot always runs the `results`/`journey` niche alternation it already had —
what's new is the **visual style**, resolved once per week by
`lib/planner.js` (`REEL_STYLES`, `pickReelStyle`):

| Style | What it looks like |
|-------|--------------------|
| `card` | One bold statement per beat over a slow Ken Burns push-in. Calm, brand-forward. |
| `kinetic_karaoke` | Words reveal one at a time **in place** (frozen layout, no reflow); the active/strongest word is lit in Trevo teal. |
| `kinetic_punch` | One big word at a time, full-screen. Fast, high-energy. |

Config-only — see `planner.REEL_STYLES` — reorder or trim with no code
change. `content.reelStyle` is saved with the week's content so
Generator/Designer/Scheduler all agree on the same pick.

---

## How it works (all $0, CPU + bundled ffmpeg only)

```
hook/body/cta (3 beats)  →  render frames (skia)  →  stitch to .mp4 (ffmpeg)  →  grade + grain  →  review queue
```

- **Frames.** `card` renders one 1080×1920 frame per beat; `kinetic` renders
  one frame per word-reveal state — Trevo navy/teal brand colors, the "TREVO"
  wordmark top-right, a Stories-style segmented progress bar (never a
  carousel counter).
- **Video.** `card` uses per-beat varied motion + beat-synced cuts; `kinetic`
  holds each word state for its own duration via ffmpeg's concat demuxer
  (frame-accurate). Both get a filmic grade + moving film grain.
- **Silent by design** — ships with a null audio track so Buffer/Instagram
  accept it; add trending audio in-app if desired.
- **Review-first** — nothing auto-posts; the reel lands in the weekly preview
  (`output/queue/preview-*.html`) with a playable `<video>` to approve.

**Code:** `lib/reel.js` (parse/build/assemble, shared with Miley unchanged),
`lib/canvas-render.js` (`renderReelFrame`, `renderReelWordFrame` — Trevo brand
adaptation), `agents/designer.js` (`renderReel`/`renderCardReel`/`renderKineticReel`,
dispatch on `content.reelStyle`), `lib/planner.js` (style rotation),
`agents/scheduler.js` (preview `<video>` tag + Buffer video upload via
`lib/buffer.js`'s `uploadVideo`).

---

## Buffer posting

`lib/buffer.js`'s `schedulePost({ imagePaths, videoPath, caption, scheduledAt })`
uploads the rendered `.mp4` to Buffer and posts it as a video, using the first
beat frame as the thumbnail. Falls back to an image-only post if the video
upload fails for any reason (network, format rejection, etc.) — the post
still goes out, just as a still.

---

## Status

- Built and verified end-to-end against Molly's evergreen fallback bank —
  both `card` and `kinetic_punch` styles confirmed rendering correctly with
  the "TREVO" wordmark and teal accent.
- Automated tests: `test/reel.test.js`, `test/canvas-render.test.js`.
- **Next:** connect Buffer and let the Analyst eventually compare which reel
  style earns the most engagement, once live Instagram insights are wired
  (same gap the caption A/B loop has today).
