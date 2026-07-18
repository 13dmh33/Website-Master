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

# CHECKPOINT — Post-call proposal core

Branch: `feature/post-call-proposal` (off `main` — no `master` branch exists in this
repo, consistent with every session this month). Not merged, not pushed to origin.
Stopped after Tier 1 + Tier 1b + Tier 2 all completed — a natural, substantial stopping
point well inside the 50–70% target, with Tier 3 and the Backlog cleanly rolling forward
exactly as the session plan anticipated ("else next session").

## What's done

15 commits. 55 new tests passing (`node --test scripts/test/proposal-*.test.js
scripts/test/brand-lint.test.js`), 17 pre-existing tests confirmed unaffected.

**Phase 0** (`/STATE-AUDIT.md`): found two of the plan's assumptions didn't hold, both
verified three independent ways before concluding:
- **Nora is not merged** (plan assumed it was) — it's complete on unmerged, unpushed
  branch `feature/nora-multichannel-config`. This branch has none of its code.
- **Stripe is not live** (plan assumed it was) — no key in `.env.local`,
  `website/checkout/index.html` still has placeholder Payment Link URLs, and
  `scripts/brief.js`'s own live blocker check independently confirms it right now.
- Also found: Tier 3 item 6 (funnel metrics) is already fully built on a separate
  unmerged branch (`feature/funnel-metrics`) — correctly not rebuilt.
- Also found and fixed: `scripts/check-email-auth.js` (built and passing since earlier
  this month) had never been committed to any branch — closed that gap first.

**Tier 1 — the anchor, built in full:**
- `scripts/lib/proposal/packages.js` + `schema.js` + `load-input.js` — input contract
  and package definitions (Starter $100 / Growth $497+$147mo / Pro $797+$197mo), fails
  loud on anything malformed. No call-notes source exists (Nora isn't merged here), so
  inputs are a small JSON file per lead at `proposals/inputs/<leadId>.json` — the plan's
  own documented fallback.
- `scripts/lib/proposal/template.js` — Gap Selling framing (pain point in their words →
  cost of inaction → package → line items → CTA), Trevo's real navy/teal brand palette,
  visually verified via an Artifact preview.
- `scripts/lib/proposal/stripe.js` — real Checkout Session generation via raw HTTPS
  (matching the repo's no-SDK convention), split into a pure request-builder (fully
  tested without a key) and the one function that touches the network, which fails loud
  immediately when `STRIPE_SECRET_KEY` is absent — it is, in this environment.
- `scripts/lib/proposal/draft-mail.js` + `state.js` — Zoho Drafts delivery
  (nodemailer `MailComposer` + `imapflow`) with a live-send gate (`PROPOSAL_SEND_LIVE`,
  off by default), and additive `state.json` fields
  (`proposalSentAt`/`proposalPackage`/`proposalAmount`/`stripeSessionId`) recorded only
  after delivery succeeds.
- `scripts/generate-proposal.js` — the CLI tying it together. Manually smoke-tested
  end to end against a disposable fake lead (created, ran, verified, cleaned up):
  generation and the local HTML write both succeeded; delivery correctly failed against
  the real account with the **exact same pre-existing IMAP-not-enabled blocker already
  known from `scripts/reply-agent.js`** (`authenticationFailed: true`, "You are yet to
  enable IMAP for your account") — and, critically, `state.json` was confirmed untouched
  afterward, proving the fail-safe ordering (record only after delivery succeeds) works.
- Money-path tests: for all three packages, the due-today total shown to the customer is
  asserted equal, in cents, to Stripe's one-time line items; unknown/missing packages
  fail loud at every layer.

**Tier 1b — open-tracking pixel, built in full:**
- `netlify/functions/proposal-open.js` — mirrors the existing `enhance.js` function's
  shape, always returns a valid 1×1 GIF regardless of logging success, logs to a new
  "ProposalOpens" Sheet tab. Extended `scripts/lib/google-sheets.js` additively
  (`GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT`, a JSON-content credential path alongside the
  existing file-path one — needed because a Netlify Function can't reference a local
  file path) — verified both paths still work.
- Live-verified against the real Sheet: tab auto-created with header, a real row landed
  and was read back and confirmed. Deployment itself (a real Netlify deploy) is out of
  reach from this environment — the actual integration this environment *can* reach was
  fully verified.

**Tier 2 — all three hygiene items, built in full:**
- Brand-standard linter (`scripts/lint-brand-standards.js`) — ran it for real: this
  session's own proposal code is clean; **the live website is not** — 15 files have
  emojis, 8 have "business day(s)" language, `website/argus/index.html` says "bot".
  Real, pre-existing, out of this session's scope to fix (large, touches live
  customer-facing copy across the whole marketing site) — flagged, not silently changed.
- Signature env-var check — rejects unset/empty/obvious-placeholder `SIGNATURE_NAME`
  values, not just a bare truthiness check.
- Deliverability preflight — one command, live-verified: SPF/DKIM/DMARC pass, and a real
  Zoho SMTP `transport.verify()` (auth check, no message sent) also passes.

## Definition of done — status against the original list

- [x] Phase 0 audit complete, `STATE-AUDIT.md` written.
- [x] A completed-call input produces a tailored one-page proposal with correct package
  and line items.
- [x] Proposal drafts to Zoho Drafts by default, sends only when `PROPOSAL_SEND_LIVE` is
  on — code path correct; **Drafts write itself is blocked on IMAP not being enabled**
  (account setting, not a defect — see above).
- [~] A live Stripe link generates with the correct amount — code path correct and fully
  tested; **cannot generate a real live link in this environment** (no
  `STRIPE_SECRET_KEY` configured — see `STATE-AUDIT.md`). Money-path tests pass for
  everything that doesn't require a live key.
- [x] Open-tracking pixel logs opens to Sheets — live-verified.
- [x] New state fields additive; existing Sheets logging intact.
- [x] `CHECKPOINT.md` present (this section).
- [x] No emojis, sentence case, no founder name in the proposal body, "AI agent" not
  "bot" — verified by the brand linter itself against this session's own output, plus
  dedicated automated tests.

## What's next

**Two real blockers, both need Dave, not more code:**
1. **Enable IMAP** for `dave@trevoadvisors.com` in Zoho Mail admin settings — blocks both
   this session's Drafts delivery and the separate Reply Agent (`claude/email-agent-scope-audit-ku4pkc`).
   Same root cause, same fix, two separate pieces of finished code waiting on it.
2. **Add a real `STRIPE_SECRET_KEY`** to `.env.local` (and replace the placeholder Payment
   Link URLs in `website/checkout/index.html` while at it — `scripts/brief.js` already
   flags that one). Once added, `node scripts/generate-proposal.js <leadId>` generates a
   real, working payment link with no code changes needed.

**Tier 3 (not started, rolls forward in priority order):**
7. Drip opt-out / unsubscribe (CAN-SPAM/A2P compliance — real legal exposure).
8. Lead dedup + phone normalization (pre-empts the Nora conversation-splitting bug from
   the prior session's adversarial audit — reuse `scripts/webhook.js`'s normalizer).
9. Client onboarding (`session-client-onboarding.md` — referenced by the plan but does
   not exist anywhere in the repo; needs to be written or the scope needs re-deriving).
10. Missed-call calculator (`session-missed-call-calculator.md` — same: referenced, not
    found).

**Backlog (unchanged, still not this session, must not be dropped):**
- Nora remediation (9 defects from the prior session's adversarial audit — highest
  priority on safety grounds, independent of revenue work; guardrail: keep real
  contractor leads out of live Nora until it lands).
- DMARC tighten to `p=quarantine` (~Aug 17, trigger is clean report cycles not the date).

**Also worth a look, found during this session, not acted on:**
- Merge `feature/nora-multichannel-config` and `feature/funnel-metrics` to `main` — both
  complete, tested, and currently invisible to any other branch (including this one).
- The live website's brand-standard violations found by the new linter (see Tier 2 above).
- `session-funnel-metrics.md`, `session-client-onboarding.md`,
  `session-missed-call-calculator.md`, `session-nora-remediation.md` — none of these
  detail files referenced throughout the plan actually exist in the repo. Either they
  live outside this repo, or they need to be (re)written before those sessions start.

## Ready-to-paste continuation prompt

```
Continue the post-call-proposal work on branch feature/post-call-proposal. Read
/CHECKPOINT.md (the "Post-call proposal core" section) and /STATE-AUDIT.md first —
Tier 1, Tier 1b, and all of Tier 2 are done and tested (55 passing tests).

Two things may have changed since: check whether IMAP is now enabled for
dave@trevoadvisors.com (retry scripts/generate-proposal.js's Drafts delivery for real
if so) and whether STRIPE_SECRET_KEY now exists in .env.local (retry a real Stripe
Checkout Session if so). If neither has changed, move to Tier 3 in order: drip
opt-out/unsubscribe (7), lead dedup + phone normalization (8), then client onboarding
(9) and the missed-call calculator (10) — note neither of the last two has a detail
file in the repo despite being referenced, so re-derive scope from the plan's one-line
descriptions or ask before building. Keep the same conventions: CommonJS, pure
computation in scripts/lib/**/*.js with node:test coverage, fail loud on money-adjacent
or credential-missing paths rather than silently defaulting.
```
