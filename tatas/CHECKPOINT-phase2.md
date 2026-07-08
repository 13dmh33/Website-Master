# Tatas Phase 2 CHECKPOINT — Reels + voiceover lane (2026-07-07)

Branch: `tatas-phase-2`, off `tatas-phase-1` (Phase 1 isn't merged to `main`
yet, and Phase 2 must sit *alongside* the carousel lane). Commit 1 = scaffold
only, per convention.

---

## What was built

A complete Reels lane, additive to the Phase 1 carousel lane. **Nothing under
`miley/`, nor any Phase 1 carousel file or workflow, was modified** — verified
by diff.

### Collision-proofing (the key design decision)
Reels live in a **separate `reels` array** in `tatas/state.json`, not mixed into
`posts`. Phase 1's `lib/state.js` loads the whole object but only ever reads/writes
`data.posts`, and its whole-object `save()` round-trips the `reels` key untouched.
So the lanes cannot collide without modifying Phase 1 — no timing dependency, no
shared status values. `lib/reels-state.js` is the reels-only accessor.

### New modules
- **`writer-reels.js`** — 5 starter topics → `claude-opus-4-8` (override via
  `TATAS_MODEL`): one 90–140 word spoken script, exactly 3 hook variants, a 4–6
  frame shot list (on-screen text), one caption + 3–5 hashtags. Same sensitivity
  system prompt as Phase 1 (respectful, non-alarmist, medically accurate, no
  fear-mongering, no diagnostic claims, stats attributed to a source type,
  screening encouraged not replaced, education tone). Conservative built-in
  fallback reels per topic for zero-key runs. Validates word count, hook count,
  frame count. Writes `type:"reel"`, `status:"pending"` to `reels[]`.
- **`scripts/publish-reels-review.js`** — the interactive review/hook-pick page
  at `website/review/tatas-reels/index.html`: per reel, 3 hooks (radio) + full
  script + shot list + caption, plus Approve/Reject. Computes a **decisions
  string** (`id:hook#` / `id:reject`, `;`-separated) with a Copy button — the
  static-site-compatible way to carry the human decision into CI.
- **`scripts/approve-reels.js`** — applies a decisions string: approve →
  `status:approved` + `chosenHook`; reject → `status:rejected`. `--list` shows
  every reel's status.
- **`voicer.js`** — approved reels without audio → ElevenLabs TTS →
  `website/social/tatas-reels/{week}/{id}.mp3`, `status:voiced`, path stored.
  Idempotent, `--dry-run`, errors clearly without the key (like Phase 1 post-due).
- **`briefer.js`** — voiced reels → CapCut brief `.md` bundle each (chosen hook,
  script, shot list, caption+hashtags, audio path + CapCut steps) + a week
  `index.html` with inline audio players. Idempotent via `briefedAt` / `--force`.
- **`render.js`** — Phase 2b scaffold (Shotstack MP4). OFF by default, refuses
  to run without `--enable`, not wired to any workflow.

### Workflows (concurrency group `tatas-reels-git-writes` — separate from Miley
AND from the carousel lane; both alert via GitHub issue on failure)
- `tatas-reels-pipeline.yml` — Fri 14:00 UTC: writer-reels → review page → commit.
  Friday deliberately follows the carousel Thursday run.
- `tatas-reels-build.yml` — manual dispatch (inputs `decisions`, `week`):
  approve-reels → voicer → briefer → commit. One tap from the GitHub phone app.

## Dry-run evidence (container, 2026-07-07)
- `writer-reels.js --fallback` → 5 pending reels, week 2026-07-13; `posts[]` stayed empty (isolation confirmed); idempotency re-run is a no-op
- `publish-reels-review.js` → interactive page, 5 reels
- `approve-reels.js` with a mixed decisions string → 4 approved (correct hooks saved) + 1 rejected; `--list` verified
- `voicer.js --dry-run` → targeted exactly the 4 approved, skipped the rejected
- briefer (against mocked voiced state) → 4 bundles + index; idempotent re-run skipped all 4
- `render.js` (no flag) correctly no-ops; `--enable --dry-run` prints the Shotstack payload
- Both workflow YAMLs parse; `git diff` confirms zero `miley/` and zero Phase 1 carousel changes
- Dry-run artifacts reset (state.json back to empty `reels[]`, generated pages removed) so the first real Friday run generates fresh

## Run steps
See `tatas/REELS.md` — setup (add `TATAS_ELEVENLABS_KEY` + `TATAS_ELEVENLABS_VOICE_ID`
secrets), local commands, and the weekly review→build routine.

## Remaining for Dave (account-side)
- [ ] ElevenLabs account → API key + a chosen voice ID → `TATAS_ELEVENLABS_KEY` + `TATAS_ELEVENLABS_VOICE_ID` GitHub secrets
- [ ] Merge `tatas-phase-2` → `main` to activate the two workflows (note: this includes the Phase 1 carousel lane, since Phase 2 stacks on it — decide whether to merge Phase 1 and Phase 2 together or land Phase 1 first)
- [ ] First live test: run tatas-reels-pipeline manually → review page → copy decisions → run tatas-reels-build → open a bundle in CapCut

## Phase 2b = automated video render (NOT built)
`render.js` is a working scaffold, intentionally gated off. To finish it: fill in
the Shotstack submit→poll→download against `TATAS_SHOTSTACK_KEY`, time the caption
clips to the actual audio duration, save the MP4 next to the mp3 (`videoPath` on
the reel), and add an opt-in step to `tatas-reels-build`. Even then the lane
should not auto-post — trending audio is added in CapCut/in-app.

---

## Polish pass (2026-07-08, branch tatas-phase-2-polish off tatas-phase-2)

Implemented the full audit follow-up. Touches the carousel lane too (authorized
by the user), so this branch stacks on Phase 2. Miley untouched (verified).

**Realness (the priority):**
- Reels are now built for REAL footage, not gradient text-cards. `writer-reels.js`
  emits `beats[{broll, caption}]` — `broll` is a real-footage search phrase,
  `caption` is short on-screen text. Replaces the old flat `shotList`.
- Spoken-cadence system prompt (contractions, direct address, punctuation pacing);
  fallback scripts rewritten to sound spoken.
- 5 NEW reel topics, distinct from the carousel lane (no cannibalization):
  mammogram-myths, first-mammogram, beyond-the-lump, questions-for-doctor,
  men-get-it-too.
- `voicer.js`: default `eleven_turbo_v2_5` (natural + ~half cost) at stability
  0.35 + style + speaker_boost; `--sample` previews the voice cheaply; `--no-vo`
  produces captions-only (trending-audio) bundles to A/B.
- `briefer.js`: per-beat timing derived from script length, word-by-word
  auto-caption instructions, and real Pexels b-roll — candidate clip URLs if
  `TATAS_PEXELS_KEY` is set, else ready-to-click search links. Handles both
  voiced and captions-only bundles.
- `publish-reels-review.js` + `render.js` updated to the beats schema.

**Cost/efficiency:**
- `skia-canvas` → `optionalDependencies`; reels + non-render carousel workflows
  install with `--omit=optional` (no needless native build). Only
  tatas-weekly-pipeline does the full install (it renders carousels).
- npm caching (`actions/setup-node` cache: npm) on all six tatas workflows.
- Both writers default to `claude-haiku-4-5` (was Opus) — same output quality on
  this structured task, ~5x cheaper.

**Code quality:**
- `--force` on both writers to regenerate a week.
- `MEDICAL_REVIEW_BY = 2026-12-31` markers on hardcoded medical claims.

**Dry-run evidence (container):** new reels writer (spoken + beats), review page,
approve (mixed hooks + reject), voicer dry-run + `--no-vo` captions-only, briefer
both branches (voiced + captions-only, timing + Pexels search links), carousel
lane still works with skia optional + Haiku + `--force`. All 6 workflow YAMLs
parse. Artifacts reset. Not built: automated Pexels-clip download into a rendered
MP4 (that's render.js / Phase 2b).
