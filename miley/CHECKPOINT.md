# Checkpoint — visual quality gate + new templates (#11)

What this adds, scoped entirely to `/miley`:

## 1. Visual quality gate — `lib/render-validate.js` (new)

`validateRender(buffer, templateName, opts)` decodes the PNG buffer (skia-canvas)
and checks, returning `{ pass, failures: string[] }`:

- **Dimensions** — `opts.expectedWidth`/`expectedHeight` match the decoded image.
- **Brand color present** — at least `brandColorMinPixelPct` (default 5%) of
  sampled pixels match one of `opts.brandColors` within tolerance.
- **Wordmark non-blank** — `opts.wordmarkRegion` isn't still background color
  (counts off-background pixels rather than averaging, so thin glyph strokes
  register even though they barely move the region's average color).
- **No text overflow** — no "ink" inside the outer `edgeBleedPx` ring, where ink
  = a pixel outside the bounding box formed by `opts.backgroundColor` +
  `opts.allowedEdgeColors` (+ tolerance). The bounding-box approach (not
  point-distance) is what makes it tolerate gradient backgrounds: intentional
  bleed elements (top accent bar, gradient stops) span a *range* of colors
  along the edge, not one fixed color.
- **Contrast** — WCAG AA (4.5:1 body / 3:1 large) per `opts.textRegions`.

Bypass: `SKIP_VISUAL_GATE=true` skips everything and logs loudly every time.

`lib/canvas-render.js` wires every render function through
`gateOrFallback(buffer, templateName, gateOpts, fallbackText, paletteKey)` —
on gate failure it logs the failures + template name and returns
`renderFallback(...)` instead, so a bad render is never written or queued.

Tests: `test/render-validate.test.js` (14 cases incl. the SKIP_VISUAL_GATE
bypass) + multi-palette regression run across all 6 `visual-config.json`
palettes confirming zero false-positive fallbacks on real renders.

## 2. Two new template functions — `lib/canvas-render.js`

- `renderCleanCard(headline, body, slideNum, totalSlides)` — light
  high-contrast card (`DESIGN.colorCardLight` bg, navy headline, pink accent
  bar), for text-heavy slots where the dark gradient competes with readability.
- `renderPhotoCard(headline, photoBuffer, attribution)` — full-bleed photo +
  navy overlay + pink brand band (Printify-mockup-ready slot). Falls back to
  `renderCarouselSlide` without crashing if `photoBuffer` is missing or fails
  to decode.

Both call `validateRender` via `gateOrFallback` before returning, and pull all
colors from `DESIGN` / the existing palette config — no new hardcoded brand
colors outside that.

## 3. Template selector — `selectTemplate(format, context)`

Weighted-random pick from `DESIGN.templateWeights[format]`, excluding
`photoCard` unless `context.hasPhoto`. **Hard no-op by default**: returns
`'v1Gradient'` unconditionally unless `process.env.TEMPLATES_ACTIVE === 'true'`.

Wired into `agents/designer.js` (`renderSingle`/`renderCarousel`) — with
`TEMPLATES_ACTIVE` unset, `selectTemplate` always returns `'v1Gradient'`,
which always falls through to the original `render.renderSingle` /
`render.renderCarouselSlide` calls. Verified via `node scripts/test-pipeline.js`
end-to-end with zero behavior change (no template fallback warnings, same
output structure as before).

## How to activate (when ready)

1. Drop Printify product mockups into `assets/products/` (see root
   `CLAUDE.md` checklist — still pending).
2. Set `TEMPLATES_ACTIVE=true` in `miley/.env`.
3. Run `node scripts/test-pipeline.js` and check the preview — `cleanCard` and
   `photoCard` will start appearing per the weights in `DESIGN.templateWeights`.

## Explicitly NOT touched

- `agents/scheduler.js` — no changes, no live-posting path altered.
- No generic templating engine/config DSL — exactly the two named functions.
- Nothing outside `/miley`.

## Tests

`npm test` (= `node --test test/`) — 14 cases in `render-validate.test.js` +
7 in `canvas-render.test.js` (template renders, fallback-on-missing-photo,
selector inactive/active + weight distribution within ±5% over 1000 samples).
All passing. No ESLint config exists anywhere in this repo (checked), so
there's nothing to lint.

## Note on branch

The original spec called for a branch named `feature/milly-templates` off
`master`. This session's governing instruction pins all work to
`claude/magical-davinci-cfrzy7` instead — committed there, not to `main`.
