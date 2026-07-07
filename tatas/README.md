# Tech 4 Tatas — content engine (Phase 1: carousel lane)

Fully automated Instagram **image-carousel** pipeline for breast cancer awareness
education, with a review-first gate. Mirrors Miley's proven direct-posting +
workflow pattern as an **isolated copy** — nothing here imports from or modifies
`miley/`, and Tatas can never break Miley.

**Review-first:** every post is created as `pending`. Nothing reaches Instagram
until you approve the week (`FORCE_QUEUE` convention). Phase 1 is carousels only —
no video/Reels (that's Phase 2).

---

## How a week flows

```
THU (cron)  writer.js    5 topics → Claude (claude-opus-4-8) → 4-8 slide carousels → 'pending' in state.json
            designer.js  slides → 1080x1080 PNGs (Bebas Neue + Inter, pink/charcoal)
            publish-cards.js  PNG → JPEG at website/social/tatas/{week}/ (IG needs public JPEG URLs)
                              + review preview at trevoadvisors.com/review/tatas/
THU-SUN     you review the preview on any device
1 tap       tatas-approve-week workflow → pending → approved  (--skip to drop a post)
MON-FRI     tatas-post-due cron (12:10 MT) posts each carousel at its slot via the
            Instagram Graph API; IG media ID recorded back to state.json
```

Post lifecycle: `pending → approved → posted` (or `skipped` · `failed` after 3
attempts · `stale` if >72h overdue — never late-posts). Token health is checked
before every posting run. All four workflows open a GitHub issue on failure.

## Layout

| Path | What |
|---|---|
| `writer.js` | The new module: 5 starter topics → Claude carousels (sensitivity rules in the system prompt: respectful, non-alarmist, medically accurate, no diagnostic claims, stats attributed "per ACS"-style, always points to professional screening). Built-in fallback carousels when no API key. |
| `designer.js` + `lib/render-cards.js` | skia-canvas slide renderer — cover / body / closing layouts. |
| `lib/instagram-publish.js` | Graph API publisher (single + carousel), adapted from Miley. |
| `lib/ig-config.js` | API flavor: default Instagram-Login (`graph.instagram.com`, no FB Page); `TATAS_IG_API_MODE=facebook` for legacy. |
| `lib/state.js` | All `state.json` I/O — additive updates only. |
| `scripts/publish-cards.js` | PNG→JPEG hosting + review preview. |
| `scripts/approve-week.js` | Approval gate. `--list` is the status dashboard. |
| `scripts/post-due.js` | Posts approved+due; retry/stale handling; `--dry-run`. |
| `scripts/refresh-token.js` | Renews the 60-day Instagram-Login token. |
| `state.json` | Single source of truth for every post. |

Workflows (repo root `.github/workflows/`, all only run from `main`, all share the
`tatas-git-writes` concurrency group — **separate from Miley's**):
`tatas-weekly-pipeline` (Thu cron) · `tatas-approve-week` (manual approve button) ·
`tatas-post-due` (Mon–Fri 18:10 UTC) · `tatas-token-refresh` (1st + 15th monthly).

## One-time setup

1. **Instagram account** — a professional (Business/Creator) account for Tech 4
   Tatas, separate from @techs4tatas.
2. **Meta app** — reuse Miley's Meta app ("Instagram API with Instagram Login",
   Dev mode, no App Review, **no Facebook Page link**): connect the Tatas account
   in the dashboard → copy the long-lived token + account ID.
3. **GitHub Actions secrets** (never reuse Miley's `INSTAGRAM_*` values):
   - `TATAS_IG_TOKEN` — long-lived token for the Tatas account
   - `TATAS_IG_USER_ID` — the account's IG user ID
   - `ANTHROPIC_API_KEY` — shared with the other engines
   - `GH_SECRETS_PAT` — fine-grained PAT (Secrets read/write) so token refresh can store renewals; shared with Miley's refresher
   - Optional repo variables: `TATAS_SOCIAL_BASE_URL` (default `https://trevoadvisors.com`), `TATAS_IG_HANDLE` (default `@tech4tatas`), `TATAS_MODEL` (default `claude-opus-4-8`)
4. **Netlify** — the site publishing `website/` must be deploying (cards + review
   page ride it).
5. Merge `tatas-phase-1` to `main` (workflows only run from main).

## Run it locally

```bash
cd tatas
npm install
node writer.js --fallback        # zero-API dry run (or drop --fallback with a key)
node designer.js
node scripts/publish-cards.js
node scripts/approve-week.js --list
node scripts/post-due.js --dry-run
```

`npm run test-pipeline` chains the whole dry run.

## Weekly routine (once live)

1. Thursday: pipeline generates next week + publishes trevoadvisors.com/review/tatas/
2. Review from your phone.
3. GitHub app → Actions → **Tatas approve week** → Run workflow (use `skip_posts`
   to drop any post by id substring).
4. Done — posts go out Mon–Fri 12:10 MT. Check anytime:
   `node scripts/approve-week.js --list`.

## Phase 2 (not built)

Reels / voiceover lane: script + voiceover generation, video assembly, and the
Graph API `REELS` media type in `instagram-publish.js`. The state schema already
carries `format` per post, so Phase 2 adds a lane rather than reshaping Phase 1.
