# Tech 4 Tatas — Reels + voiceover lane (Phase 2)

Additive lane alongside the Phase 1 carousel pipeline. Generates spoken scripts
+ hooks for Instagram Reels, gates them behind a review-first **hook/tone**
approval, then produces a voiceover + a CapCut-ready brief bundle per approved
item.

**This lane does NOT auto-post.** Reels need trending audio added in-app, so it
ends at a downloadable bundle (chosen hook + script + shot list + caption +
voiceover mp3), not a live post.

## Isolation from the carousel lane

Reels live in a **separate `reels` array** inside `tatas/state.json` — never
mixed into `posts`. Phase 1's `lib/state.js` only ever touches `data.posts` and
round-trips every other key untouched, so the two lanes physically cannot
collide: no carousel script sees a reel, no reel script sees a carousel. Nothing
under `miley/` or the Phase 1 carousel files/workflows is modified.

## How a week flows

```
FRI (cron)  writer-reels.js         5 topics → Claude (claude-haiku-4-5):
                                     spoken script (90-140w, written for the EAR) + 3 hooks
                                     + 5-7 beats {real b-roll phrase + short caption} + caption/hashtags
                                     → 'pending' in reels[]
            publish-reels-review.js  interactive review page → trevoadvisors.com/review/tatas-reels/
FRI-SUN     you review on your phone: per reel, pick 1 hook (radio) + Approve/Reject
            → tap "Copy decisions" → get a decisions string
1 tap       tatas-reels-build workflow: paste decisions, Run workflow →
              approve-reels.js  applies hooks/approve/reject
              voicer.js         approved reels → ElevenLabs mp3 (or --no-vo captions-only)
              briefer.js        voiced reels → CapCut bundle: beats + real b-roll links (Pexels)
                                + per-beat timing + word-by-word caption guidance
you         open trevoadvisors.com/review/tatas-reels/{week}/ → build each in CapCut over REAL footage
```

## Making them feel real (design choices)
- **Real footage, not text cards.** Each beat carries a b-roll search phrase; the
  bundle links straight to portrait Pexels clips (real clip URLs if `TATAS_PEXELS_KEY`
  is set, else a search link). The on-screen caption rides over that footage.
- **Written for the ear.** The system prompt forces spoken cadence — contractions,
  direct address, punctuation-as-pacing — not essay prose.
- **A human-sounding voice.** `voicer.js` defaults to `eleven_turbo_v2_5` at
  stability 0.35 with style + speaker boost (not a flat narrator). Run
  `node voicer.js --sample` to preview the voice cheaply before voicing full scripts.
- **Word-by-word native captions.** Briefs instruct CapCut auto-captions, not
  full-sentence static cards — the strongest "a person edited this" signal.
- **Captions-only variant.** `--no-vo` produces trending-audio + captions bundles
  (no voiceover) — often the most native format; worth A/B-ing.
- **Distinct topics.** Reel topics don't overlap the carousel lane (no cannibalization).

Reel lifecycle: `pending → approved (+chosenHook) | rejected → voiced` (briefer
stamps `briefedAt`). The **hook + Approve/Reject choice is the single most
important control** in this lane — it's the tone gate before anything is voiced.

## Files

| Path | What |
|---|---|
| `writer-reels.js` | 5 starter topics → Claude reels (same sensitivity system prompt as Phase 1: respectful, non-alarmist, medically accurate, no fear-mongering, no diagnostic claims, stats attributed "per ACS"-style, always points to professional screening). Conservative built-in fallback reels for zero-key runs. |
| `lib/reels-state.js` | `reels[]` I/O — additive only, isolated from `posts[]`. |
| `scripts/publish-reels-review.js` | Builds the interactive review/hook-pick page. |
| `scripts/approve-reels.js` | Applies the decisions string. `--list` is the status view. |
| `voicer.js` | Approved reels → ElevenLabs voiceover mp3. Idempotent; `--dry-run`. |
| `briefer.js` | Voiced reels → CapCut brief bundles + week index. Idempotent; `--force`. |
| `render.js` | **Phase 2b, OFF by default** — Shotstack MP4 render scaffold. Not wired to any workflow. |

Workflows (repo root `.github/workflows/`, run from `main`, concurrency group
`tatas-reels-git-writes` — separate from Miley's and from the carousel lane's):
`tatas-reels-pipeline` (Fri cron: writer + review page) · `tatas-reels-build`
(manual: apply decisions → voice → brief). Both open a GitHub issue on failure.

## One-time setup

Everything the carousel lane needs, plus:
- `TATAS_ELEVENLABS_KEY` + `TATAS_ELEVENLABS_VOICE_ID` as GitHub Actions secrets
  (from elevenlabs.io — an API key and a voice ID from your voice library).
- Optional repo var `TATAS_ELEVENLABS_MODEL` (default `eleven_multilingual_v2`).
- `ANTHROPIC_API_KEY` + `TATAS_SOCIAL_BASE_URL` are shared with the carousel lane.

## Run it locally

```bash
cd tatas
npm install
node writer-reels.js --fallback              # zero-API dry run (drop --fallback with a key)
node scripts/publish-reels-review.js         # → website/review/tatas-reels/index.html
node scripts/approve-reels.js --decisions "ID:2;ID2:reject"   # apply hook/approve choices
node voicer.js --dry-run                      # (drop --dry-run with an ElevenLabs key)
node briefer.js                               # CapCut bundles + index
node scripts/approve-reels.js --list          # status of every reel
```

## Phase 2b (not built — optional)

`render.js` scaffolds a Shotstack render (shot list + audio → base MP4 with
burned-in captions). OFF by default and not in any workflow; the Phase 2
deliverable ends at the CapCut brief bundle. See `CHECKPOINT-phase2.md`.
