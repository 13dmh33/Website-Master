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

<!-- ---- merged notes from claude/aggregator-outreach-fvlmw8 ---- -->

# Aggregator outreach engine — checkpoint

**Branch:** `claude/aggregator-outreach-fvlmw8` (off `main` — this repo has no `master`;
the task brief's `feature/aggregator-outreach` name was superseded by the harness's
designated branch for this session).
**Status:** Built and smoke-tested end to end. Live scraping not run for real (Outscraper
blocked from this container, same as Scout — needs `OUTSCRAPER_API_KEY` + a Mac run).

## Deliverables checklist

- [x] Branch created (see note above re: branch name)
- [x] Scraper added — `aggregator/scripts/scraper.js`, national, all 4 `source_type`s,
      matches the spec's CSV/JSON schema exactly
- [x] `trade_school` program filter (plumbing/electrical/hvac/roofing default) +
      `TRADE_SCHOOL_ALL=true` env var (or `--all-programs` flag) working
- [x] `needs-email-*.csv` fallback working — orgs with a website but no email never
      block the main run
- [x] `state.json` `aggregator` lane + `track_link` added — additive only, verified with
      `git diff` (new top-level `aggregator` stats block + new optional `queue[].lane` /
      `source_type` / `track_link` fields; zero existing records touched)
- [x] Per-org `track_link` assignment working (`aggregator/lib/track-link.js`) —
      cal.com base URL + UTM params encoding `source_type` + org slug; doubles as the
      lane-1 affiliate-tracking code per spec (no separate payment infra built)
- [x] 4 email sequences drafted and queued (no sends), reply-exit wired
      (`node aggregator/scripts/email-sequences.js --mark-replied <lead_id>`)
- [x] `aggregator` Checker eval profile — 8 evals (spec asked for 5+), isolated from
      `scripts/checker.js`'s existing no-website/audit-pitch evals
- [x] 2 PDF templates -> 4 outputs generated and verified as valid single-page PDFs
      (`pdf_license_prep.pdf`, `pdf_sbdc_handout.pdf`, `pdf_trade_school.pdf`,
      `pdf_bonding_partner.pdf`), each with a QR code linking to the booking URL
- [x] No modifications to existing pipeline files — confirmed:
      `git diff --stat -- scripts/ config/ agents/ website/ molly/ miley/ reeve/ strategy/ state.json run-daily.sh`
      returns empty. Touched outside `aggregator/`: `package.json` (added 4 `agg:*`
      scripts + `pdfkit`/`qrcode` deps), `package-lock.json`, `.env.local.example`
      (2 new optional vars), `.gitignore` (ignore generated PDFs + needs-email CSVs).
- [x] This file

## What got built

```
aggregator/
  scripts/
    scraper.js          — CLI: --lane <license_prep|bonding_insurance|sbdc_score|trade_school>
    email-sequences.js  — drafts the 3-email/lane sequence, mail-merge, reply-exit
    checker.js           — aggregator eval profile (local, no API calls — copy is
                            templated, not AI-generated, so no rewrite loop needed)
    pdf-generator.js     — pdfkit + qrcode, 2 content templates -> 4 PDFs
  lib/
    sources.js            — per-lane Maps query templates + SBDC/SCORE seed fetch stubs
    dedupe.js              — domain-first, then org_name+city dedup
    track-link.js          — UTM-tagged cal.com link builder
    csv.js                  — CSV export (schema + needs-email)
    merge.js                — {{field}} mail-merge + deterministic subject-variant pick
    state-writer.js         — additive-only state.json read/write helpers
  templates/
    email-templates.json     — all 4 lanes x 3 emails + subject variants
    student-handout-content.js — "first 5 steps" master handout (steps 1-5, step 4 = website)
    bonding-partner-content.js — lane-2 B2B one-pager content
  agents/aggregator.md   — pipeline-order doc, same style as /agents/*.md
  leads/, outreach-queue/, pdfs/  — output dirs (leads/ and outreach-queue/ tracked in
  git like the existing leads/ and queue/ dirs; pdfs/*.pdf gitignored as local build output)
```

## Pipeline order

```bash
node aggregator/scripts/scraper.js --lane license_prep --state CO --force        # Mac only
node aggregator/scripts/scraper.js --lane bonding_insurance --city "Denver, CO" --force  # Mac only
node aggregator/scripts/scraper.js --lane sbdc_score --city "Denver, CO" --force # Mac only
node aggregator/scripts/scraper.js --lane trade_school --state CO --trade electrical --force  # Mac only
node aggregator/scripts/email-sequences.js --write   # container-safe
node aggregator/scripts/checker.js --write           # container-safe
node aggregator/scripts/pdf-generator.js --all        # container-safe
```

## Known gaps / next steps (flagged, not hidden)

- **SBDC/SCORE structured seeds are stubs.** `americassbdc.org/find-your-sbdc/` and
  `score.org/find-mentor` are JS-rendered directories — a real parse needs either their
  lookup API or a headless browser, neither of which is wired up. `fetchSbdcSeeds()` /
  `fetchScoreSeeds()` in `aggregator/lib/sources.js` currently return `[]` and the
  scraper falls back cleanly to per-metro Maps queries for `sbdc_score`, exactly as the
  spec's fallback language allows — but this lane will under-deliver vs. license_prep/
  bonding_insurance/trade_school until that's built out.
- **Outscraper calls are container-blocked** (verified — `CONNECT tunnel failed, 403` to
  `api.app.outscraper.com`, `americassbdc.org`, `score.org` from this sandbox). Same
  constraint as Scout. Run the scraper on Mac with a real `OUTSCRAPER_API_KEY`.
- **No live send path exists, by design.** `email-sequences.js` never imports
  `nodemailer`. Wiring an actual send (presumably reusing Pitcher's Zoho transport
  pattern, gated behind its own explicit opt-in) is a deliberate follow-up decision,
  not an oversight.
- **A/B subject-line testing** is seeded (every lane/step has 2 subject variants,
  picked deterministically per lead so the same org always sees the same variant
  across the sequence) but there's no stats-tracking/epsilon-greedy rotation like
  `scripts/template-picker.js` — not needed until there's real send volume to learn from.
- Smoke-tested with throwaway sample orgs (not real scraped data) through the full
  scraper-parsing -> dedupe -> email-sequences -> checker -> pdf-generator chain;
  artifacts were deleted afterward so `aggregator/leads/` and `aggregator/outreach-queue/`
  are empty on this commit, ready for a real Mac scraper run.
