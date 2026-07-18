# Merlin (nightly advisor agent) — Phase 0 state audit

Branch: `feature/merlin-advisor` (off `main` — no `master` branch exists in this repo,
consistent with every session this month).

## Task 0 — protect existing work: DONE

- `feature/nora-multichannel-config` pushed to origin (8 commits, was local-only).
- `feature/funnel-metrics` pushed to origin (7 commits, was local-only).
- `main` reconciled: origin/main had drifted further than the plan assumed — 5 commits
  ahead (not 1), including the Reply Agent merge (`claude/email-agent-scope-audit-ku4pkc`
  landed on `main` since the last check), not just a Milly update. Merged cleanly except
  one real conflict in `package.json` (both sides added a dependency — `mailparser` from
  origin, `twilio` already on local main — resolved by keeping both) and two conflicts
  from a stashed-then-restored pre-existing local worktree (`CLAUDE.md`: two different
  changelog entries, kept both; `miley/templates/evergreen.json`: pure `lastUsed`
  timestamp bumps from Miley's own automated runs, took the newer upstream side
  throughout). Pushed — `main` and `origin/main` are now identical
  (confirmed via `git rev-parse`).
- Also merged `origin/feature/funnel-metrics` into this branch (not part of the plan's
  literal Task 0, but see the funnel-data finding below for why) — clean, no conflicts,
  31 tests passing (17 pre-existing + 14 from that branch).
- **Pushing `main` required explicit user confirmation mid-session**: the system flagged
  that `13dmh33/Website-Master` is a public GitHub repo and `main`'s history contains
  real scraped business contact data (names/phones/emails in `state.json`/`queue/*.json`/
  `leads/*.json`). This isn't new exposure — that data was already on `origin/main` from
  earlier pushes, and it's B2B cold-outreach data, not consumer PII — but the system
  required a named, explicit go-ahead before pushing more of it. Confirmed by the user;
  proceeded. Worth keeping in mind for Merlin's own report: it should not assume `main`
  pushes are silently safe to recommend without surfacing the same consideration.

## Does an advisor/report agent already exist?

**No** — checked carefully, this genuinely isn't built anywhere:

- `strategy/agents/strategist.js` (the plan's implicit "closest thing" given its
  `CLAUDE.md` description — "business intelligence and pricing monitor") is **entirely
  Reeve-scoped**. It reads `reeve/output/{clients,opportunities,conversations,pitches}`
  only — zero references to `state.json`, Trevo's `queue/`, or anything in root
  `scripts/`. Root `CLAUDE.md`'s framing of Strategy as a general cross-system monitor
  does not match the actual code. Not usable as-is, not a real precedent for auditing
  Trevo's pipeline specifically.
- `scripts/reporter.js` and `scripts/brief.js` produce daily summaries but don't rank
  candidate next-moves or recommend a session — they're status reports, not advisors.
- job-hunter (Missy) is the closest *conceptual* precedent (score, rank, digest,
  review-only) but **the plan's "reuse its scheduled review-only pattern" doesn't fully
  hold** — job-hunter has no GitHub Actions workflow or cron anywhere in its directory
  (checked: no `.yml` files outside `node_modules`). It's run manually
  (`npm run daily` on demand). The **real, proven scheduling precedent in this repo** is
  the GitHub Actions pattern already used three times — `milly-weekly-*.yml`,
  `miley-weekly-*.yml`, `.github/workflows/funnel-dashboard.yml` (checkout, setup Node,
  run script, commit + push output, upload artifact as a 90-day-retention backup). Merlin
  follows that pattern, not job-hunter's manual-run one.

## What's machine-readable headless at 1am

- **Git metadata**: yes, standard `git` commands (branch list, log, rev-list for
  ahead/behind, `ls-files` for tracked/untracked) — all confirmed working throughout this
  session with zero external dependency.
- **`state.json`**: yes, plain JSON read.
- **Google Sheets**: yes — real service-account credentials exist in `.env.local`
  (`GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`), proven working live multiple times this
  session (ApolloMetrics tab, ProposalOpens tab, both created and read back for real).
- **Funnel dashboard data**: `website/dashboard/funnel-data.json` and the underlying
  `scripts/lib/funnel.js` / `scripts/lib/apollo-metrics.js` / `scripts/lib/lead-files.js`
  only existed on the (until Task 0) unmerged `feature/funnel-metrics` branch. **Merged
  that branch into this one** so Merlin can call the real, tested funnel/Apollo
  computation directly instead of re-implementing the same logic a second time with a
  risk of drift. This was a judgment call beyond the plan's literal Task 0 scope, made
  because the alternative (duplicate the stage-ranking/anchor logic from scratch) is
  strictly worse.
- **Config files**: yes — `config/*.json` are plain JSON, including the real per-unit
  cost rates already in use: `cost-tracker.js`'s `APOLLO_PER_CREDIT_USD = 0.049` and
  `TWILIO_PER_SMS_USD = 0.0079`, and `diagnoser-config.json`'s Anthropic Haiku token
  rates (`input_per_mtok: 0.80`, `output_per_mtok: 4.00`, etc.). `unit-costs.json` seeds
  from these real numbers rather than inventing figures.
- **Send logs**: yes — `messages/*.json` (per-lead sent records) and `logs/*.log`
  (daily agent run logs) are both plain-text/JSON, readable headless.

## Zoho SMTP send path — confirmed headless, confirmed reaches an external Gmail address

`ZOHO_EMAIL`/`ZOHO_APP_PASSWORD` are real, present in `.env.local`. SMTP (unlike IMAP —
see the standing action-items memory) is unaffected by the known IMAP-disabled account
blocker; `pitcher.js` has been sending real outbound email all session via
`smtp.zoho.com:465`. SMTP is a store-and-forward relay protocol with no
destination-domain restriction — Zoho's outbound relay does not care whether the
recipient is Gmail, Outlook, or anything else. Confirmed live as part of building
Merlin's mailer (see the mailer commit) with a real send to `13dmh33@gmail.com`.

## Known data-integrity flags Merlin must surface, not trust blindly

Carried forward from the standing action-items memory, all still true as of this branch:
- `poller.js` does not write `replied` into `state.json` for email replies the way
  `webhook.js` does for SMS — email replies are undercounted in any `state.json`-derived
  funnel view.
- `checker-config.json`/`diagnoser-config.json` daily limits were bumped 30 -> 250 on
  2026-06-30 to clear a backlog; unclear if ever reverted — Merlin checks the live value
  each run rather than assuming.
- `closed` status in `state.json` has never meant "deal won" in this pipeline's history —
  every observed occurrence has been a data-quality rejection. Merlin's report must not
  present a `closed` count as revenue.
- Apollo hit-rate figures read zero/n-a until Enricher is run for real with the new
  instrumentation (shipped, not yet exercised).

## Everything else in the plan

Read/log-only scope, additive-nothing (Merlin doesn't touch `state.json` at all — it's
pure read), CommonJS (matching every other session this month's correction of the plan's
"Node.js/ESM" assumption — this repo has never been ESM), and the explicit
`MERLIN_ACTOR` stub-only requirement are all followed as specified.
