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
