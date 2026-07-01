# Lifestyle photos (manual background tier)

Drop photos here to use as card backgrounds for non-product posts (trades_humor,
motivational, engagement, mission, awareness_stat, mission_recap, etc.) — a step
above the Unsplash auto-fetch, since these are your own/curated shots instead of
generic stock.

## Naming

- `<contentType>.png` or `<contentType>-1.png`, `<contentType>-2.png` (any number)
  for variety — the designer picks randomly among matches for that post's
  contentType.
- `generic-1.png`, `generic-2.png`, etc. — used for any contentType that has no
  dedicated photo.

## Priority order (lib/canvas-render.js drawBackground)

1. `assets/products/{key}.png` — product mockup, for product posts
2. `assets/lifestyle/` (this folder) — manual lifestyle photo
3. Unsplash auto-fetch (if `UNSPLASH_ACCESS_KEY` is set)
4. Gradient fallback (always available)

Faces should stay non-identifiable to protect Riley's anonymity if any real
likeness is involved — AI-generated images sidestep that entirely.
