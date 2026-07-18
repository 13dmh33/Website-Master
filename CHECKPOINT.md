# Sheet-Log CHECKPOINT

Documents the Google Sheets CRM integration (`scripts/sheet-log.js`).

---

## Column Map — SentLog tab (16 columns, A–P)

| Col | Header           | Source                                      | Notes                          |
|-----|------------------|---------------------------------------------|--------------------------------|
| A   | company          | `brief.business_name`                       |                                |
| B   | email            | `brief.email`                               | Match key for update-or-insert |
| C   | trade            | `brief.trade`                               |                                |
| D   | last send        | Most-recent email title (see labels below)  | Auto-updated each run          |
| E   | date updated     | Today's date (script runtime)               | Auto-updated each run          |
| F   | status           | **User-editable** — never overwritten       | Default on new row: `sent`     |
| G   | demo URL         | `brief.demo_url`                            |                                |
| H   | email 1 sent     | `sent.email_sent_at` or `entry.sent_at`     | Initial outreach date          |
| I   | email 2 sent     | `sent.drip.d1.email_sent_at`                | Day 4 drip                     |
| J   | email 3 sent     | `sent.drip.d1b.email_sent_at`               | Day 8 drip                     |
| K   | email 4 sent     | `sent.drip.d1c.email_sent_at`               | Day 12 drip                    |
| L   | last reply date  | `sent.replied_at` / `entry.reply_received_at` |                              |
| M   | reply summary    | `sent.reply_subject`                        | Subject line only; body not stored |
| N   | unsubscribed     | `entry.status === 'unsubscribed'`           | TRUE / FALSE                   |
| O   | unsubscribe date | Same timestamp as reply when unsub detected |                                |
| P   | notes            | **User-editable** — never overwritten       | Free text                      |

### Column F status values
`sent` · `replied` · `quoted` · `customer` · `lost` · `do not contact`

Set by Dave by hand. The script sets the default (`sent`, `replied`, or `do not contact`)
only on new rows. On every subsequent run it preserves whatever value Dave has set.

---

## ChangeLog tab

Append-only ledger. Columns: `timestamp | action | company | email | change`

- `action = "new row"` — first time a lead is written to the Sheet
- `action = "updated"` — a meaningful field changed

Only logged when something meaningful changes:
- `last send` updated (new drip step sent)
- `email 2 / 3 / 4 sent` gained a date
- `last reply date` set or changed
- `unsubscribed` changed to `TRUE`

Rows where nothing meaningful changed are silently skipped (no changelog noise from
`date updated` refreshing every run).

---

## Drip step labels (column D)

| Step | Days out | Label shown in "last send" column            |
|------|----------|---------------------------------------------|
| d1   | 4        | Do you actually need a website if referrals keep you busy? |
| d1b  | 8        | Who's answering your phone when you're on a job? |
| d1c  | 12       | Searched "[trade] [City]" — here's what I found |
| d2   | 19       | Closing the loop — [Business Name]           |

Initial email labels map from `brief.template_id` (0–6) to the subject in
`config/templates.json`.

---

## Update-or-insert logic

The script matches existing sheet rows by **email address** (column B).

- **Match found** → updates the row in-place; columns F and P are read from the
  sheet and written back unchanged.
- **No match** → appends a new row; default status = `sent` (or `replied` /
  `do not contact` if already known from pipeline state).

Migration from old 8-column format is handled automatically: the script finds the
`email`, `status`, and `notes` columns by header name regardless of their position.

---

## Authentication setup

1. Create a Google Cloud service account with no roles.
2. Download the JSON key file; store it outside the repo.
3. Add to `.env.local`:
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/key.json
   SHEET_ID=<the long ID from the Sheet URL>
   SHEET_TAB=SentLog         # optional; default is SentLog
   ```
4. Open the Sheet → Share → paste the service account's `client_email` → Editor.
5. The script creates the `SentLog` and `ChangeLog` tabs automatically on first run.

---

## Run instructions

```bash
# Preview what would sync (no writes)
node scripts/sheet-log.js --dry-run

# Sync all email leads to the Sheet
node scripts/sheet-log.js
```

Run after `node scripts/pitcher.js` and after `node scripts/drip.js` to keep the
Sheet current. Safe to re-run — idempotent. Does NOT modify `state.json`.

---

## CAN-SPAM compliance warning

**The email templates in `config/templates.json` do not include an opt-out / unsubscribe
line.** Under CAN-SPAM, every commercial email must contain a clear unsubscribe mechanism.
Penalty: up to **$50,674 per violation**.

Add an opt-out line to every email template before sending at volume, e.g.:

> *Reply STOP to unsubscribe from future emails.*

The script marks a lead `do not contact` in column F when `entry.status === 'unsubscribed'`
or `sent.status === 'unsubscribed'`, but the poller (`scripts/poller.js`) does **not**
automatically classify email STOP replies — that classification must be done manually or
by wiring `scripts/reply-classifier.js` into the poller.

---

## Known limitations

- **Reply body not stored** — column M (reply summary) shows only the subject line.
  Bodies are intentionally not persisted anywhere in the pipeline.
- **d2 has no dedicated timestamp column** — Day 19 drip is visible via column D
  ("last send") but has no own date column. The date it was sent appears in column E
  ("date updated") the next time the script runs after d2 fires.
- **SMS-only leads excluded** — sheet-log only tracks email-channel leads. SMS-only
  outreach is not written to the Sheet.

---

# CHECKPOINT — Contact-Page Email Scraper

Branch: `feature/contact-page-scraper` (merged to `main`)
Date: 2026-06-29
Status: ✅ Built, unit-tested. Needs a real run on the Mac for live email results.

## What was built

`scripts/contact-scraper.js` — a zero-API-cost script that visits the websites of
has-website leads and extracts a publicly visible email, flipping SMS-only leads into
email-capable leads so the existing email pipeline can use them. Free alternative to
Apollo (Enricher): no paid API, no credit cap. New file only — **no existing pipeline
file was modified.**

## How it actually works

- A lead's `email` lives in its record inside `leads/*.json`.
- `channel` is **not stored** — `diagnoser.js` derives it at diagnose time.

So to make an SMS-only lead email-capable, the scraper:

1. Writes the scraped email into that lead's `leads/*.json` record — additive only.
2. Resets that lead's `state.json` status to `scouted` so Diagnoser re-runs and
   regenerates an email-appropriate brief. Prior status saved as `preScrapeStatus`.

Run order: **scraper → Diagnoser → Checker → Pitcher**.

## How to run

```bash
# On the Mac (container egress is proxy-blocked)
node scripts/contact-scraper.js              # real run
node scripts/contact-scraper.js --dry-run    # preview only
node scripts/contact-scraper.js --limit 20   # cap sites visited
```

## Notes

- 170 of current leads have no website — scraper can't help them (need Apollo/Enricher).
- 11 has-website / no-email leads are the target set; run on Mac for real results.
- No JS rendering — obfuscated emails won't be caught by design.

---

# CHECKPOINT — Funnel metrics (Apollo hit-rate + conversion dashboard)

Branch: `feature/funnel-metrics` (off `main` — no `master` branch exists in this repo,
same as the Nora session). Not merged, not pushed to origin. Stopped at ~90% usage per
the session's own protocol — this checkpoint written immediately after the last commit,
no work left mid-state.

## What's done

All 6 tasks from the session scope doc are complete, plus Step 0 discovery. 14 new tests
passing (`node --test scripts/test/apollo-metrics.test.js scripts/test/funnel.test.js`),
17 pre-existing tests confirmed unaffected. Commits, in order:

1. `Funnel metrics: Step 0 discovery` — `/DISCOVERY.md`. Key findings: Enricher never
   touched `state.json` before this session; `replied`/`hot` are real statuses currently
   at zero live occurrences (measured fact, not a guess — 163 leads sent, zero replies
   recorded yet); every one of the 11 live `closed` leads is a data-quality rejection,
   never a won deal, and `status: 'closed'` is never even set by any script; `opened` has
   no tracking anywhere; `state.json`'s queue mirrors `messages/*-sent.json` for every
   transition that matters, so the queue alone is sufficient for stage counts; repo is
   CommonJS, not ESM (same delta as the Nora session).
2. `Enricher: additive Apollo attempt/hit instrumentation` — `apolloAttempted`,
   `apolloHit`, `apolloCreditSpent` added at all 4 existing per-lead write points, zero
   control-flow change (diffed against `main` to confirm — only the 3 new fields per
   write, nothing else touched).
3. `Apollo hit-rate rollup script` — `scripts/lib/apollo-metrics.js` (pure) +
   `scripts/apollo-hit-rate.js` (runner). Reports phone-only (no-website mode, the
   literal scope-doc framing) as the headline, has-website mode as a separate breakdown.
   Live-verified against the real Sheet — creates "ApolloMetrics" tab, writes header,
   appends rows, read back and confirmed.
4. `Funnel stage counts + conversion math` — `scripts/lib/funnel.js`. Two views:
   `rawCounts` (current distribution, no interpretation) and `cumulativeReached` /
   `transitions` (reached-at-least-this-far, built by ranking the real linear sequence
   and anchoring the 3 exit statuses — closed at "scouted", unsubscribed at "sent",
   unresponsive at "drip_d2_sent" — see DISCOVERY.md for why each anchor was chosen).
   `biggestDropoff` flags by absolute leads lost (the literal ask), separate from
   `worstConversionRate` since they can point at different transitions.
5. `Funnel + Apollo hit-rate dashboard — static page render` — `scripts/lib/lead-files.js`
   (shared loader, factored out of task 3's script), `scripts/generate-funnel-dashboard.js`,
   `website/dashboard/{funnel.html,funnel-data.json}`. Brand-compliant static page,
   verified visually via an Artifact preview before committing. Surfaces the biggest
   drop-off (currently checked -> sent, 458 leads) with an inline caveat that it's very
   likely the 30/day Pitcher send cap, not a quality problem — verified against the real
   `config/pitcher-config.json`. Includes an explicit "what this dashboard cannot measure
   yet" panel (opened, booked/won, closed != won, and a warning that `leads-web/` isn't
   tracked in git so the CI refresh only sees the phone-only Apollo breakdown reliably).
6. `Scheduled daily funnel dashboard refresh` — `.github/workflows/funnel-dashboard.yml`,
   mirrors `milly-weekly-analytics.yml`'s exact pattern (checkout main, setup Node 20,
   run + commit + push + upload artifact). Core dashboard generation needs zero secrets
   (reads only repo-committed files); the optional Apollo Sheets sync skips gracefully
   without `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT`/`SHEET_ID` repo secrets, which aren't
   configured yet — see "What's next" below.

## Definition of done — status against the original list

- [x] Enricher records Apollo attempt/hit per lead, additively — diffed against `main`
  to confirm zero outcome/control-flow change.
- [x] Rollup reports hit rate % and cost per successful email to a Sheet tab (and log).
- [x] Dashboard shows counts per real stage and conversion % per transition, biggest
  drop-off flagged.
- [x] Apollo hit rate appears on the same dashboard.
- [x] Refreshes daily via existing automation pattern (GitHub Actions, matching Milly/Miley).
- [x] All new state fields additive (`leads/*.json`/`leads-web/*.json`, not `state.json` —
  see DISCOVERY.md for why); existing pipeline behavior and Sheets logging untouched.
- [x] `DISCOVERY.md` and `CHECKPOINT.md` present.
- [x] No emojis, sentence case, no "business days" language — grepped across every new/
  touched file; the only emoji hits found were pre-existing console-log symbols in
  `enricher.js` (✓/✗/⚠), confirmed via `git diff main` to not be part of this diff.

## What's next (not started, needs explicit ask before building)

- No real Enricher run has happened since this instrumentation shipped — all Apollo
  hit-rate figures currently read zero/n/a. That's expected (measures forward from
  deploy, no historical backfill, per the scope doc's explicit out-of-scope item), but
  means the headline number won't be real until Enricher runs again for real.
- `leads-web/` is not tracked in git (confirmed via `git ls-files leads-web/` — 0 files).
  The scheduled dashboard refresh runs from a fresh checkout, so it will never see
  has-website-mode Apollo data until that directory (or at least the enriched files) gets
  committed. Not fixed this session — wasn't asked, and it's a bigger call (there may be a
  reason it was left untracked) than this session's scope covers.
- To enable the Apollo Sheets sync in the scheduled GitHub Actions run, add
  `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT` (the service account key's raw JSON content) and
  `SHEET_ID` as repo secrets. Without them the workflow still runs and still regenerates
  the dashboard — it just skips the Sheets append step.
- `poller.js` doesn't write `replied` into `state.json` for email replies the way
  `webhook.js` does for SMS (DISCOVERY.md finding) — a pre-existing pipeline gap, not
  something this session touched, but it means email replies are currently undercounted
  in the funnel. Worth a future session if email reply volume matters.
- Drip A/B variant tracking and aggregator lane attribution — explicitly out of scope
  this session per the doc.

## Ready-to-paste continuation prompt

```
Continue the funnel-metrics work on branch feature/funnel-metrics. Read /CHECKPOINT.md
(the "Funnel metrics" section) and /DISCOVERY.md first — everything through the original
session's 6 tasks is done and tested (14 new tests passing).

Next up: [fill in — e.g. "run Enricher for real and confirm the hit-rate rollup shows
real numbers" or "decide whether to commit leads-web/ so CI sees has-website Apollo data"
or "wire replied-tracking for email replies via poller.js"]. Keep the same conventions:
CommonJS (not ESM — see DISCOVERY.md delta), pure computation in scripts/lib/*.js with
node:test coverage, read/log-only unless explicitly asked to change pipeline behavior.
```

---

# CHECKPOINT — Merlin (nightly advisor agent)

Branch: `feature/merlin-advisor` (off `main` — no `master` branch exists in this repo).
Not merged, not pushed to origin yet. **This session completed the entire scope** — all
7 functional-spec items and every definition-of-done item, not a partial rollover.

## What's done

12 commits, 42 new tests passing (`node --test merlin/test/*.test.js`), 31
pre-existing/funnel-metrics tests confirmed unaffected.

**Task 0** (protect existing work, done first as instructed): pushed
`feature/nora-multichannel-config` and `feature/funnel-metrics` to origin (both were
local-only, at risk). Reconciled `main` — origin/main had drifted further than the plan
assumed (5 commits ahead, including the Reply Agent merge landing since the last check,
not just 1 Milly commit) — merged cleanly with one real conflict resolved
(`package.json`, kept both sides' dependency additions) plus two conflicts from a
stashed-then-restored pre-existing local worktree (resolved by content inspection, not
guessing). Pushing `main` required an explicit mid-session user confirmation after the
system flagged the repo is public and carries real scraped business contact data —
confirmed, proceeded. Also merged `feature/funnel-metrics` into this branch (beyond
Task 0's literal scope) so Merlin could reuse its tested funnel/Apollo logic directly
instead of re-implementing it.

**Phase 0** (`/STATE-AUDIT.md`): found no advisor/report agent exists anywhere in the
repo today — `strategy/agents/strategist.js` (the plan's implicit closest precedent) is
entirely Reeve-scoped despite `CLAUDE.md` describing it as a general monitor, and
job-hunter has no actual scheduling (no cron/GH Actions anywhere in its directory)
despite the plan's "reuse its scheduled pattern" assumption. The real, proven scheduling
precedent is the GitHub Actions pattern already used three times.

**All 7 functional-spec items built and live-verified against real data, not mocked:**

1. `merlin/lib/git-health.js` — branch staleness/unpushed/unmerged/divergence/untracked
   dirs. Live run correctly flagged `claude/miley-techs4tatas` as stale-but-safe-to-delete
   (merged, 45 ahead) and `claude/kind-hypatia-3YzM0` as genuinely stale-and-unmerged.
2. `merlin/lib/pipeline-snapshot.js` — funnel + Apollo ROI (reusing the merged-in
   `scripts/lib/funnel.js`/`apollo-metrics.js`) + live-checked integrity flags. Caught
   something real on its first live run: `checker-config.json`/`diagnoser-config.json`
   are still at daily_limit 120/100, never reverted from the 2026-06-30 backlog bump —
   exactly the unresolved item root `CLAUDE.md`'s own action items already named.
3. `merlin/config/unit-costs.json` + `merlin/lib/cost-audit.js` — real logged spend
   ($1.28 this month) from this repo's own `cost-tracker.js`, not a vendor dashboard;
   labeled projections for inactive services (Apollo unconfigured, Twilio at $0 pending
   A2P); cost-per-outcome correctly `null` (not `$0`) since zero leads have replied.
4. `merlin/lib/ranking.js` — the opinionated core. Fixed rubric,
   revenue-proximity-weighted 3x above build-volume penalty, hard rule. **On this
   session's real data, the top-ranked recommendation is a zero-build-volume "clear the
   458-lead backlog" action** (score 27), beating the fully-built Stripe-key unlock
   (score 24) and far outranking the Nora safety remediation (score 1, correctly last —
   high build volume, zero near-term revenue proximity). This is the actual "don't build"
   behavior the spec requires, produced by the rubric on real numbers, not hand-tuned.
5. `merlin/lib/session-prompt.js` — primary (bundles ranked items to 2.5h+, this run:
   3.45h/6 items) and light alternate (zero-build-volume subset only, this run: 1.25h/4
   items) both render in Dave's own standing session structure, verified brand-compliant.
6. `merlin/lib/report.js` — the dated report, verified readable and complete (repo
   health, funnel, integrity caveats, Apollo, cost audit with assumptions, full ranked
   backlog appendix so nothing not chosen is lost).
7. `merlin/lib/mailer.js` — **sent a real email to 13dmh33@gmail.com** built from this
   session's actual live data (real messageId returned). SMTP confirmed unaffected by
   the standing IMAP-disabled blocker.

`merlin/lib/actor-gate.js` — `MERLIN_ACTOR` stub, `isActorEnabled()` always `false`,
`assertActorNotImplemented()` throws if anything tries to wire a real action to it.

`merlin/run.js` ties it together; ran it for real (`--no-email`, mailer already verified
separately) and committed the first genuine output at
`merlin/reports/2026-07-18/{report.md,session-primary.md,session-light.md}`.

`.github/workflows/merlin-nightly.yml` — daily 1am MDT/7am UTC, mirrors the
funnel-dashboard/Milly/Miley pattern exactly, doesn't collide with the pitcher cron
(8:03am MT) or the funnel-dashboard refresh (7am MDT).

## Definition of done — status against the original list

- [x] Task 0 complete: both branches + main safe on origin.
- [x] `STATE-AUDIT.md` written.
- [x] Merlin runs headless end-to-end on demand, producing a dated report, a primary
  session prompt (3.45h, exceeds the 2.5h/50% floor), and a light alternate — all
  live-verified in Dave's standing structure.
- [x] Cost audit produces labeled estimates from `unit-costs.json` with assumptions listed.
- [x] Ranking applies the revenue-proximity-over-build-volume rule and is capable of
  recommending don't-build — confirmed on real data, not just in a synthetic test.
- [x] Report + both prompts delivered to 13dmh33@gmail.com via Zoho SMTP (real send,
  real messageId) and written to dated repo files (committed).
- [x] 1am schedule wired, review-only, non-colliding.
- [x] Advisor-only guarantee holds: grepped the full diff — no code/branch/config/
  outreach mutation anywhere; `MERLIN_ACTOR` exists only as an unimplemented,
  always-false, default-off stub.
- [x] `CHECKPOINT.md` present (this section) — was living/updated after most tasks
  rather than only at the end, per the session's own standing rules.
- [x] No emojis, sentence case, "AI agent" not "bot" — verified by dedicated automated
  brand-compliance tests on the actual report/prompt output, not just eyeballed.

## What's next (not started, real follow-ups found along the way)

- **Known limitation, not fixed this session**: `actions/checkout` only creates a local
  branch for the checked-out ref, so `git-health.js`'s CI-run branch list will be far
  sparser than an interactive run — fix is to read `refs/remotes/origin/` instead of
  `refs/heads/`, no local branch creation needed. See `merlin/CLAUDE.md`.
- Push `feature/merlin-advisor` to origin (not done yet — this checkpoint was written
  immediately after the last commit).
- Decide on a merge plan for `feature/nora-multichannel-config` and
  `feature/funnel-metrics` (Merlin's own ranking surfaces this as a real candidate,
  score 7 — moderate priority, cheap).
- Everything in the standing action-items memory is unchanged and still real: IMAP still
  disabled, no Stripe key, Twilio A2P still pending, Apollo not configured
  (`APOLLO_API_KEY` absent — confirmed again this session), checker/diagnoser limits
  still elevated (freshly reconfirmed live by Merlin itself this session).
- Add `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT`/`SHEET_ID`/`ZOHO_EMAIL`/`ZOHO_APP_PASSWORD`/
  `APOLLO_API_KEY` as GitHub repo secrets if not already present, so the 1am CI run can
  actually send (the funnel-dashboard workflow already documents needing the first two;
  `ZOHO_EMAIL`/`ZOHO_APP_PASSWORD` may already exist as secrets per
  `milly-weekly-analytics.yml`'s Reeve-notification step — worth checking before adding).

## Ready-to-paste continuation prompt

```
Merlin (branch feature/merlin-advisor) is fully built and tested — all 7 functional-spec
items done, all definition-of-done items met, real live verification throughout
(real email sent, real Sheets/cost-log reads, real ranking output on real data). Read
/CHECKPOINT.md (this section) and /STATE-AUDIT.md for full detail.

Nothing is unfinished from the original scope. Next steps are operational, not build
work: push this branch to origin, add any missing GitHub repo secrets so the 1am
scheduled run can actually send email, and separately consider running
node merlin/run.js for real (with email) once merged to main, to start getting real
nightly reports. If new build work is wanted, Merlin's own first real report already
recommends one: clear the checked-but-unsent backlog (zero build required) — see
merlin/reports/2026-07-18/report.md for the full ranked list before starting anything new.
```
