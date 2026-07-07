# Tatas Phase 1 CHECKPOINT — carousel lane (2026-07-07)

Branch: `tatas-phase-1` (off `main` — repo has no `master`; same default branch).
Commit 1 = scaffold only, per convention.

---

## What was built

A complete, isolated `tatas/` pipeline mirroring Miley's direct-posting pattern
for a second brand + second Instagram account. **Zero files under `miley/` were
read-imported or modified** — all six reused modules were copy-and-adapted:

| tatas file | Cloned from (Miley) | Adaptation |
|---|---|---|
| `lib/instagram-publish.js` | `miley/lib/instagram-publish.js` | `TATAS_IG_TOKEN` / `TATAS_IG_USER_ID` |
| `lib/ig-config.js` | `miley/lib/ig-config.js` | `TATAS_IG_API_MODE` |
| `scripts/publish-cards.js` | `miley/scripts/publish-cards.js` | reads `tatas/state.json`; hosts to `website/social/tatas/` + `website/review/tatas/` |
| `scripts/approve-week.js` | `miley/scripts/approve-week.js` | state.json posts instead of queue files |
| `scripts/post-due.js` | `miley/scripts/post-due.js` | state.json; same retry×3 / stale>72h / token-health / igMediaId conventions |
| `scripts/refresh-token.js` | `miley/scripts/refresh-token.js` | refreshes `TATAS_IG_TOKEN` |

(Note: those Miley modules live on branch `claude/project-overview-9uoqjr`, not
yet on `main` — the tatas copies were recreated from that work, keeping this
branch fully self-contained.)

New code:
- **`writer.js`** — 5 hardcoded starter topics → `claude-opus-4-8` (override via
  `TATAS_MODEL`) → 4–8 slide carousels (one line per slide + caption + 3–5
  hashtags), written to `state.json` as `pending`. System prompt enforces the
  sensitivity rules (respectful, non-alarmist, medically accurate, no
  fear-mongering, no diagnostic claims, stats attributed to a source type,
  screening encouraged not replaced, education tone). Medically conservative
  built-in fallback carousels per topic for zero-key runs / API failures.
- **`designer.js` + `lib/render-cards.js`** — skia-canvas 1080×1080 renderer
  (cover / body / closing layouts, Bebas Neue + Inter, pink/charcoal palette).
- **`lib/state.js`** — additive-only `tatas/state.json` access.

Workflows (all with issue-on-failure alerting and the `tatas-git-writes`
concurrency group, separate from Miley's):
- `tatas-weekly-pipeline.yml` — Thu 14:00 UTC: writer → designer → publish-cards → commit
- `tatas-approve-week.yml` — manual one-tap approve (inputs: `week`, `skip_posts`)
- `tatas-post-due.yml` — Mon–Fri 18:10 UTC (= 12:10 MT slots)
- `tatas-token-refresh.yml` — 1st + 15th monthly, updates the `TATAS_IG_TOKEN` secret via `GH_SECRETS_PAT`

## Dry-run evidence (container, 2026-07-07)

- `writer.js --fallback` → 5 pending posts, week 2026-07-13, idempotency re-run confirmed no-op
- `designer.js` → 28 slides rendered, real brand fonts, visually verified (cover/body/closing)
- `publish-cards.js` → 28 valid 1080×1080 baseline JPEGs + self-contained review page
- `approve-week.js` — `--dry-run` with `--skip` and `--list` verified
- `post-due.js --dry-run` — nothing-due, due-carousel URL construction, and stale(>72h) paths all verified via scratch posts
- All 4 workflow YAMLs parse; `git status` confirmed zero `miley/` modifications
- Dry-run artifacts then reset (state.json emptied, generated images removed) so
  the first real Thursday run generates fresh Claude content

## Run steps

See `tatas/README.md` — one-time setup (Meta app reuse, TATAS_ secrets, Netlify),
local commands, and the weekly review routine.

## Remaining for Dave (account-side)

- [ ] Create/confirm the Tech 4 Tatas professional IG account (separate from @techs4tatas)
- [ ] Connect it in the existing Meta app → long-lived token → `TATAS_IG_TOKEN` + `TATAS_IG_USER_ID` GitHub secrets
- [ ] Confirm `GH_SECRETS_PAT` + `ANTHROPIC_API_KEY` secrets exist
- [ ] Merge `tatas-phase-1` → `main` to activate the workflows
- [ ] First live test: run tatas-weekly-pipeline manually → review → approve → watch Monday's post

## Phase 2 = Reels / voiceover lane (not built)

Planned shape: script + voiceover generation (TTS), video assembly (ffmpeg or
similar), `REELS` media type support in `lib/instagram-publish.js` (video_url
container + longer processing polls), a `format: 'reel'` lane in state.json, and
a renderer for cover frames. Slots/approval/posting infrastructure from Phase 1
carries over unchanged.
