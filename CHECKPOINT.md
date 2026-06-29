# CHECKPOINT — Sheet-Log (Google Sheet sent-log / CRM)

Branch: `feature/sheet-writeback` (off `main`)
Date: 2026-06-29
Status: ✅ Built, tested (dry-run + synthetic email-lead + JWT signing). Needs Google
service-account setup + a real run on a machine that can reach Google (Mac).

## What was built

`scripts/sheet-log.js` — after emails go out, appends one row per sent-email lead to a
Google Sheet so the Sheet works as a simple CRM / sent-log. **One-way append only** (what
went out). Dave reads replies in Zoho and fills the reply/notes columns by hand. Two-way
reply sync is intentionally out of scope.

New file only — **no existing pipeline file was modified.** Zero new npm dependencies: the
Google service-account auth (JWT → access token) is hand-rolled with Node's built-in
`crypto` + `fetch`, so there is nothing extra to `npm install`.

## Columns appended (fixed order)

`company | email | trade | status (="sent") | demo URL | sent date (ISO) | reply (blank) | notes (blank)`

If the Sheet has no header row yet, the header is written first.

## How it decides what to log

- Reads `state.json` for leads with `status === 'sent'` (how `pitcher.js` marks a send —
  `updateState(leadId,'sent')`), excluding any already marked `loggedToSheet: true`.
- Confirms it was an **email** send via `messages/{lead_id}-sent.json` → `email_sent === true`
  (pitcher writes this). If that file is absent, falls back to: the brief has an email and an
  email channel.
- After a **successful** append, marks each logged lead `loggedToSheet: true` in `state.json`
  (additive — no other field touched) so re-runs never duplicate rows. If the append fails,
  nothing is marked, so a re-run is safe.

## Which sheet / which tab

Writes to a **dedicated tab** (default name `SentLog`) inside whatever spreadsheet `SHEET_ID`
points to. The tab is **auto-created** if missing, and **no other tab is touched** — so you can
point this at the same spreadsheet you use for `sheet-import` (the curated-leads list,
`1MNTg-WIT-NwwtOnP4QDs9M5QuG8UcDnmX8Jj8SxtTc8`) and the sent-log lands in its own `SentLog`
tab, leaving your curated-leads tab alone. Override the tab name with the optional `SHEET_TAB`
env var.

## How to run

```bash
node scripts/sheet-log.js --dry-run   # show the rows that WOULD be appended; writes nothing
node scripts/sheet-log.js             # append to the Sheet, then mark leads logged
```
Run after each `node scripts/pitcher.js --channel email` batch.

## Google setup — numbered checklist (one-time, novice level)

You need a **service account** (a robot Google account) and you share your Sheet with it.

1. Go to **console.cloud.google.com** and sign in. At the top, click the project dropdown →
   **New Project** → name it `trevo-sheets` → Create. Make sure it's selected.
2. In the search bar type **"Google Sheets API"** → open it → click **Enable**.
3. In the search bar type **"Service Accounts"** → open it → **+ Create Service Account** →
   name it `sheet-logger` → Create and Continue → skip the optional steps → **Done**.
4. In the service-accounts list, click the one you just made → **Keys** tab → **Add Key** →
   **Create new key** → choose **JSON** → Create. A `.json` file downloads. **Keep it private.**
   Move it somewhere stable, e.g. `~/trevo-sheet-key.json`.
5. Open that JSON file and copy the value of **`client_email`** (looks like
   `sheet-logger@trevo-sheets.iam.gserviceaccount.com`).
6. Open your target Google Sheet (the curated-leads one is fine — the script writes to its own
   `SentLog` tab and won't touch your leads tab) → click **Share** → paste that `client_email`
   → set it to **Editor** → Send. (This is the step everyone forgets — the robot can't write
   until the Sheet is shared with it.)
7. Get the **Sheet ID** from the Sheet's URL: it's the long string between `/d/` and `/edit`
   in `https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit`. For the curated-leads
   sheet that's `1MNTg-WIT-NwwtOnP4QDs9M5QuG8UcDnmX8Jj8SxtTc8`.
8. In the repo, open `.env.local` (same file Zoho/Twilio keys live in) and add two lines:
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON=/Users/dave/trevo-sheet-key.json
   SHEET_ID=THE_LONG_ID_FROM_STEP_7
   ```
   (Use the real path from step 4 for the first line.)
9. Test it: `node scripts/sheet-log.js --dry-run` (no Google needed — just shows the rows).
   Then for real: `node scripts/sheet-log.js`.

If you see "the Sheet is not shared with the service-account email," redo step 6.

## Test results (container, 2026-06-29)

- **JWT signing path**: built and RS256-signed a token assertion with a throwaway key —
  3-part JWT produced correctly (the crypto/auth path is sound).
- **Dry-run against current `state.json`**: 48 sent leads found, all correctly classified as
  **SMS sends → 0 to append** (the email-only filter works; the existing sent leads were the
  earlier SMS batch).
- **Synthetic email-sent lead**: injected one `status:'sent'` lead with an email brief +
  `email_sent:true` messages record → produced exactly one correctly-ordered row:
  `Test Plumbing Co | owner@testplumbing.com | plumber | sent | https://…/for/?b=Test | 2026-06-29 | (blank) | (blank)`.
  Fixture removed afterward; repo clean.

Not run against the live Sheet (no service-account key + container can't reach Google).
Do the 9 setup steps on the Mac, then `node scripts/sheet-log.js`.

## Out of scope (by design, this session)
- Reading replies back from the Sheet / two-way sync.
- Updating existing rows (status changes) — append-only.
