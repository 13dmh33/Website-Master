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
