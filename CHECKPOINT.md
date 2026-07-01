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

# CHECKPOINT — Directory Scout (public-directory lead sourcing)

Date: 2026-07-01
Status: ✅ Built + tested (20 tests: 15 unit + 5 offline end-to-end). The full
logic chain (YP HTML → lead → contractor-site HTML → email) is proven offline;
the licensing (CSV) source is verified end-to-end with a real write/dedup cycle.
Live YP/BBB fetch could NOT be validated from the container — its egress proxy
403s every external host (confirmed via curl, proxy status, and WebFetch), and
policy denials must not be retried. Those two sources need one Mac run to confirm
live selectors; the tooling below makes that a one-command check.

## Why this exists

Google Maps (Outscraper, via Scout `--mode has-website`) only returns a website URL
for ~35% of listings — the other ~65% leave it blank, so the contact-scraper has
nothing to visit. This is what wall-ed the email pipeline: repeated has-website Scout
runs across Denver/Houston/Atlanta returned 0 usable leads (`No real site: 65` etc.).
Public directories list the contractor's own website far more reliably. Directory Scout
turns those directories into Scout-shaped leads so the existing pipeline
(contact-scraper → Diagnoser → Checker → Pitcher) works unchanged.

## Architecture

One shared foundation + thin per-source adapters + one runner:

- `scripts/lib/directory-scout.js` — shared: lead formatting (scout-has-website shape),
  dedup (by lead_id + site domain, against state.json + leads/ + leads-web/),
  CSV export, state.json queue writes (additive, mirrors Scout's `updateState`),
  needs-email CSV. Pure functions (`formatLead`, `dedupAndFormat`, `toCsv`,
  `hostFromUrl`) are separated from I/O so they unit-test without network/disk.
- `scripts/lib/dir-yellowpages.js` — parses YP search HTML → name + **site_url** +
  phone + review count + address. Best source (exposes the contractor's own domain).
- `scripts/lib/dir-bbb.js` — parses BBB's JSON search API (their HTML is JS-rendered).
  Some site_urls, all name/phone. Established/accredited businesses.
- `scripts/lib/dir-licensing.js` — ingests a state board's CSV export (TDLR/DORA/DOPL/
  CSLB). State-agnostic fuzzy header mapping; add a state by exporting its CSV, no code.
  Yields name/phone/address (+ email if the board includes it) — rarely websites.
- `scripts/directory-scout.js` — CLI runner tying adapters to the shared lib.
- `scripts/test/directory-scout.test.js` — 15 unit tests (formatters, dedup, all 3 parsers).

## How to run (Mac — container egress is proxy-gated, same as Scout)

```bash
node scripts/directory-scout.js --source yellowpages --trade plumber   --city "Denver, CO"
node scripts/directory-scout.js --source bbb         --trade electrician --city "Austin, TX" --pages 3
node scripts/directory-scout.js --source licensing   --file exports/tdlr.csv --trade plumber --city "Austin, TX"
#   --pages N   pages to fetch (yellowpages/bbb; default 2)
#   --limit N   cap usable leads written this run
#   --dry-run   parse + dedup + print, write nothing
#   --csv       also write a leads-web/ CSV of the usable leads
```

Usable leads (with a site_url or email) land in `leads/dir-<source>-<city>-<trade>-<date>-runN.json`
and are queued in `state.json` as `scouted`. Leads with only name/phone route to a
`leads-web/needs-email-…csv` for Apollo/manual. **Run order after:**
`contact-scraper.js` (fills emails from the new site_urls) → `diagnoser.js` →
`checker.js` → `pitcher.js`.

## Notes / honest limits

- **Yellow Pages** = the workhorse (most site_urls per run). **BBB** = fewer site_urls,
  all phone (feeds Apollo when no site). **Licensing** = a verified roster, but mostly
  name/phone (feeds Apollo/manual, not contact-scraper) — its value is ToS-clean coverage
  of every licensed contractor, not websites.
- HVAC is blocked in the runner (conflict-of-interest policy), same as Scout.
- Additive to state.json (never removes/rewrites existing entries). Idempotent — re-runs
  dedup against prior output. Verified: a real licensing run wrote 2 leads + queued them,
  a re-run skipped both as duplicates, state restored cleanly.
- Network parsers (YP HTML, BBB JSON) are written against current markup and are defensive
  (YP has THREE website-extraction strategies incl. a fallback that survives a class rename),
  but confirm selectors on the first live Mac run — if a site reshuffles its HTML, only the
  adapter's regex changes; the rest of the pipeline is untouched.
- **Safety net if a live run parses 0 despite HTTP 200:** the runner says so LOUDLY and
  points you at the offline path. Save the results page from your browser and run
  `--html <file> --dry-run` to validate the parser without a fetch (`--save-html <dir>`
  dumps what a live fetch received). If it still parses 0, that saved file is exactly what
  to hand back for a regex fix — a one-round turnaround, not a stuck morning.
- Plain `fetch` (no browser), matching contact-scraper. If a directory's anti-bot blocks
  plain fetch on the Mac, the pre-installed Playwright/Chromium is the fallback (swap
  `fetchBody` for a headless fetch in the adapter — interface stays the same).
