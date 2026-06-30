# CHECKPOINT — sheet-log.js v2 (CRM refinement)

Branch: `feature/sheet-log-refine`
Date: 2026-06-30
File changed: `scripts/sheet-log.js` only

---

## What changed vs v1

| Area | v1 | v2 |
|------|----|----|
| Columns | 8 (company, email, trade, status, demo URL, sent date, reply, notes) | 14 (see below) |
| Write mode | append-only; skipped already-logged leads | **update-or-insert**: updates existing rows in place, appends new leads |
| Drip tracking | none | columns for all 4 email timestamps (initial + 3 drip steps) |
| Reply logging | manual column | auto-populated from `messages/{id}-sent.json` when poller has run |
| Unsubscribe | not tracked | dedicated flag column + date; checked from state.json AND sent record |
| state.json writes | set `loggedToSheet: true` after append | **none** — update-or-insert is idempotent; no state tracking needed |

---

## New column set (A–N)

| Col | Name | Source |
|-----|------|--------|
| A | company | `brief.business_name` |
| B | email | `brief.email` — **the unique match key** |
| C | trade | `brief.trade` |
| D | status | `sent` / `replied` / `unsubscribed` (derived, see below) |
| E | demo URL | `brief.demo_url` |
| F | email 1 sent | `sent.email_sent_at` OR `entry.sent_at` (initial pitcher send) |
| G | email 2 sent | `sent.drip.d1.email_sent_at` (day 4 check-in) |
| H | email 3 sent | `sent.drip.d1b.email_sent_at` (day 8 missed-call) |
| I | email 4 sent | `sent.drip.d1c.email_sent_at` (day 12 competitor) |
| J | last reply date | `sent.replied_at` date part (poller sets this) |
| K | reply summary | `sent.reply_subject` — the email subject line of the reply |
| L | unsubscribed | `TRUE` / `FALSE` |
| M | unsubscribe date | date of the opt-out reply |
| N | notes | **Dave fills — preserved on every update** |

`drip d2` (day 19 final touch) is the 5th email and is not tracked — the spec covers 4 columns.

---

## Update-or-insert logic

On every run the script:
1. Fetches all rows from the `SentLog` tab.
2. Builds an `email → {sheetRow, existingNotes}` map.
3. For each lead that was email-sent (`entry.sent_at` set + email channel):
   - **If the email exists in the map** → batch-UPDATE that row in place, preserving column N notes.
   - **If the email is new** → APPEND a new row.
4. Header row is always refreshed to the 14-column set (safe to run when migrating from old 8-column data).

**Notes are never overwritten.** The script reads column N from the Sheet before writing and puts the existing value back.

**Old 8-column data** (from v1): the script detects where `notes` lives in the existing header (`headerRow.indexOf('notes')`) and reads from the right column whether the sheet is 8-column or 14-column. On the update pass, notes are carried forward into the new 14-column row.

---

## Reply data — wired, but requires poller to run

Reply fields (J, K, L, M) are populated from `messages/{id}-sent.json`, written by `poller.js`.

`poller.js` sets:
- `sent.status = 'positive'` on any email reply it detects
- `sent.replied_at` = ISO timestamp
- `sent.reply_subject` = subject line of the reply

**Limitation**: poller stores the subject line only, not the message body. Column K ("reply summary") shows the subject. If you want a richer summary, you must type it in column K manually.

**`messages/` is gitignored.** The sent files live only on the Mac where pitcher/poller run. Sheet-log reads them if they exist; if the Mac's repo has them but the container doesn't, they'll be absent in the container — run sheet-log on the Mac alongside pitcher/drip/poller.

> ⚠️ **Until `node scripts/poller.js` is running on the Mac**, columns J–K and the `replied` status stay blank/`sent`. That is expected — replies must be polled first.

---

## Unsubscribe detection

A lead is flagged unsubscribed if **either**:
- `state.json` entry has `status === 'unsubscribed'` (set by `updateState()` when mobile.js / webhook.js processes a STOP reply)
- `messages/{id}-sent.json` has `status === 'unsubscribed'` (set by the SMS reply path)

When flagged: column D = `unsubscribed`, column L = `TRUE`, column M = the opt-out date.

**The script does not set unsubscribed status itself** — it only reads existing flags. The unsubscribe mechanism must exist upstream (see CAN-SPAM warning below).

---

## ⚠️ CAN-SPAM opt-out compliance — action required

**This script tracks opt-outs but does NOT create the opt-out mechanism.** Under CAN-SPAM (and common-sense cold-email practice), every commercial email must:

1. **Include a visible opt-out method** in the email body — typically a line like:
   > "Reply STOP to unsubscribe."
   or a mailto unsubscribe link.

2. **Honor opt-out requests within 10 business days** — no further commercial email to that address.

3. **Be a physical-address disclosure** — include a valid postal address.

**Current gap**: the outgoing email templates in `config/templates.json` do not include an unsubscribe line. This must be added before sending at any volume. Failure to honor opt-outs risks:
- Domain blacklisting (Zoho/Google spam filters will notice)
- CAN-SPAM violations ($50,674 per violation)

**Recommended fix**: add a one-line footer to every email template (e1–e7) in `config/templates.json`:
```
To stop receiving emails, reply with STOP.
```
And ensure `poller.js` / `webhook.js` correctly classify and record STOP replies as `unsubscribed`. The classifier already handles this (`reply-classifier.js` maps `stop` → `'unsubscribed'`), but `poller.js` currently calls `markPositive()` for all replies without running the classifier on the body. Wiring the classifier into poller would close this gap for email opt-outs.

---

## How to run

```bash
# After pitcher run:
node scripts/sheet-log.js --dry-run   # preview what will change
node scripts/sheet-log.js             # sync to Sheet

# After drip run (picks up new email 2/3/4 timestamps):
node scripts/drip.js
node scripts/sheet-log.js

# After poller run (picks up reply data):
node scripts/poller.js
node scripts/sheet-log.js
```

Runs on **Mac only** (requires Google Sheets credentials in `.env.local`; same as before).

---

## Environment variables (unchanged from v1)

```
GOOGLE_SERVICE_ACCOUNT_JSON=<path to service-account JSON key file>
SHEET_ID=1MNTg-WIT-NwwtOnP4QDs9M5QuG8UcDnmX8Jj8SxtTc8
SHEET_TAB=SentLog   # optional; defaults to SentLog
```

---

## Migration from v1

First run of v2 on an existing sheet with 8-column data:
1. Header row is updated to 14 columns automatically.
2. Existing 8-column rows are updated in place: columns A–H are rewritten with fresh
   data, columns I–N are added. Old column H (notes from v1) is detected via
   `headerRow.indexOf('notes')` and carried forward to the new column N.
3. No rows are duplicated. No state.json changes.

---

## Real-run summary

*To be filled after first run on Mac. Run `node scripts/sheet-log.js` and paste output here.*

Expected output shape:
```
Sheet-Log
────────────────────────────────────────────────────────────
email leads to sync: 51
  skipped — never reached pitcher: 237
  skipped — not an email send:    0
  skipped — no brief found:       0
Refreshed header to 14 columns.
────────────────────────────────────────────────────────────
Summary
  rows updated:  51
  rows appended: 0
  total synced:  51
  errors:        0
```
(All 51 existing sent leads will UPDATE; no new appends until next pitcher run.)
