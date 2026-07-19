# Merlin — nightly advisor agent

**Directory:** `/merlin`
**See also:** `/STATE-AUDIT.md` (Phase 0 findings) and `/CHECKPOINT.md`'s "Merlin" section.

A scheduled, headless, review-only agent. Runs at 1am, reads the repo and business data,
audits performance and cost, and produces a dated report plus two ready-to-paste Claude
Code session prompts. Advisor only — it recommends, it never acts.

## Hard rule

Merlin reads and writes only its own reports/prompts under `merlin/reports/`. It never
modifies code, pushes/deletes branches, changes configs, or sends outreach. Its only
outbound action is emailing its own report to `13dmh33@gmail.com`.
`merlin/lib/actor-gate.js`'s `MERLIN_ACTOR` is a documented, unimplemented, default-off
stub for any future autonomous-action capability — nothing is gated on it yet, and
nothing should be until a real actor capability is built and reviewed separately.

## Architecture

Pure computation, thin I/O at the edges — same pattern as this repo's other recent
subsystems (Nora, funnel-metrics):

- `lib/git-health.js` — branch staleness, unpushed/unmerged, main vs origin divergence,
  untracked top-level directories. Every function takes an injectable `exec`.
- `lib/pipeline-snapshot.js` — funnel + Apollo ROI (reuses `scripts/lib/funnel.js` /
  `apollo-metrics.js` directly, merged onto this branch from `feature/funnel-metrics` —
  see `STATE-AUDIT.md` for why duplicating that logic would have been worse) plus
  send-activity-vs-cap and live-checked data-integrity flags.
- `lib/cost-audit.js` — real logged spend from `scripts/cost-tracker.js`
  (`config/cost-log.json`, this repo's own record, not a vendor dashboard) plus labeled
  projections from `config/unit-costs.json` for currently-inactive services. Never
  fabricates a number — a zero-outcome cost-per-result is `null`, not `$0`.
- `lib/ranking.js` — the opinionated core. Fixed rubric,
  `score = revenueProximity*3 - buildVolume*1` (hard rule, not tunable per run —
  revenue proximity weighted 3x above build volume). Candidate pool is static (standing
  backlog items) plus dynamic (generated from the live pipeline snapshot — e.g. a
  zero-build "clear the backlog" candidate when one exists). Capable of, and on this
  session's real data actually does, recommend a zero-build-volume "don't build" move.
  **Before ranking, candidates are filtered against two sources of truth so Merlin
  stops re-recommending settled work** (the "confidently wrong advice" fix): `repoFacts`
  (live repo state + all branches — drops anything already done, e.g. a merge that
  landed or the poller fix once it exists) into `ranking.resolved`, and `decisions`
  (durable recorded decisions) into `ranking.superseded`. Surviving funnel candidates
  are cross-referenced against integrity caveats they overlap, so a drop-off already
  explained by a standing decision carries that caveat instead of being re-raised as new.
- `lib/decisions.js` + `decisions.json` — durable decisions a review session records so
  they persist across nightly runs. Each may `supersede` candidate ids (removed from the
  ranked pool, shown struck-through in the report) and/or `explain` integrity-flag ids
  (attached as a caveat). Seeded with `backlog-is-arithmetic`. Dave/review-sessions edit
  the JSON; Merlin only reads it.
- `lib/repo-facts.js` — live resolution of machine-verifiable candidates against real
  repo state, reading **all branches** (`git rev-list --all -- <path>`), not just the
  checked-out one. Resolves `revert_elevated_daily_limits` (config on disk),
  `merge_nora_and_funnel_metrics` (dirs present on main), `fix_poller_email_reply_gap`
  (poller.js references reply-classifier). Injectable exec/read for testing.
- `lib/session-prompt.js` — renders both prompts in Dave's own standing session
  structure (ordered priority queue, atomic commits, living CHECKPOINT, graceful stop).
  Primary bundles ranked candidates until the queue reaches 2.5h (50% of a 5-hour
  window); light alternate is the zero-build-volume subset only — genuinely smaller,
  not just a shorter slice. **Every queue is split by `executor` into a Claude Code lane
  (repo file read/write tasks the agent session actually performs) and a Dave lane
  (browser / vendor-dashboard / phone tasks the agent cannot do — get a Stripe key, flip
  a Zoho setting, run a Mac-only send).** Mixing the two in one prompt was a real defect;
  unclassified items default to the Claude Code lane so nothing is silently assumed done.
- `last-funnel.json` — the previous run's funnel cumulative counts, persisted so the next
  run can detect **stalled stages** (a stage whose count hasn't moved since last run, with
  leads still waiting — a distinct signal from the biggest one-time drop-off, usually
  meaning an operational step isn't running). Committed by the nightly workflow so the
  comparison survives ephemeral CI runners.
- `lib/report.js` — assembles the full dated markdown report.
- `lib/mailer.js` — Zoho SMTP send to `13dmh33@gmail.com`, matching `pitcher.js`'s
  proven transport shape.
- `run.js` — the CLI orchestrator. Writes `merlin/reports/YYYY-MM-DD/` then emails
  (unless `--no-email`). Never touches `state.json` or any config file.

## Config

`config/unit-costs.json` — per-unit cost rates, editable by Dave, seeded from real rates
already in use elsewhere (`cost-tracker.js`, `scout-config.json`,
`diagnoser-config.json`) rather than invented figures.

## Running it

```bash
node merlin/run.js              # full run: writes dated files + emails the report
node merlin/run.js --no-email   # writes dated files only

npm run test -- merlin/test/*.test.js   # or: node --test merlin/test/*.test.js
```

Env vars (from `.env.local`): `ZOHO_EMAIL`, `ZOHO_APP_PASSWORD` (required for the send —
SMTP is unaffected by the standing IMAP-disabled blocker documented in the standing
action-items memory). `APOLLO_API_KEY` is optional — its absence is detected and
reported, not treated as an error.

## Scheduling

`.github/workflows/merlin-nightly.yml` — daily 1am MDT / 7am UTC, matching the pattern
already used by `funnel-dashboard.yml` and the Milly/Miley weekly workflows. Does not
collide with the pitcher cron (8:03am MT) or the funnel dashboard refresh (7am MDT).

**Known limitation, partially addressed**: `actions/checkout` only creates a local
branch for the checked-out ref, so `git-health.js`'s branch list (which reads
`refs/heads/`) will be far sparser in the CI run than in an interactive session with all
local branches present (`refs/remotes/origin/` reading is still a follow-up there). This
no longer affects *findings* accuracy, though: `lib/repo-facts.js` resolves "is this work
already done?" via `git rev-list --all -- <path>`, which spans every ref regardless of
local-branch creation — so Merlin's candidate filtering sees all branches even when its
health summary doesn't.

## Out of scope this session

- Any autonomous action / actor mode — `MERLIN_ACTOR` stub only, see above.
- Vendor-dashboard API integrations for exact cost — proxy estimates only.
- Fixing the integrity issues Merlin surfaces (e.g. the poller email-reply gap) —
  Merlin reports them; fixing them is a future session it may itself recommend.
