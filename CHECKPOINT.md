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

<!-- ---- merged notes from feature/gap-reply-agent ---- -->

# Reply Agent — CHECKPOINT

Documents `scripts/reply-agent.js` — gap-selling email drafting for inbound replies.

---

## Step 0 decision: Zoho Drafts vs local queue

**Decision: Local review queue (`messages/reply-drafts-queue.json`)**

Zoho Drafts via REST API requires:
- Registering a separate Zoho OAuth 2.0 client in the Zoho Developer Console
- An interactive browser authorization flow to get a refresh token
- Ongoing refresh-token management (stored + rotated)
- Fetching the Zoho account ID and Drafts folder ID before any write

None of this infrastructure exists in the codebase. The existing setup uses Zoho only via IMAP (imapflow) and SMTP (nodemailer), both with username + app-password — no OAuth tokens.

The local queue achieves the same review workflow: the daily digest email delivers every draft's full body inline, Dave reads it, copies the body into Zoho as a reply, and sends it himself. Same steps as opening a Zoho draft.

---

## How drafts are reviewed and sent

1. **Hourly**: agent polls IMAP, classifies replies, calls Claude, saves drafts to `messages/reply-drafts-queue.json`.
2. **Once per day** (first run with pending drafts): agent emails Dave a digest with every pending draft's full body.
3. **Immediately for hot leads** (high-confidence positive intent): agent sends a separate notification email on the same run that catches the reply.
4. **Dave reviews**: reads the digest or notification email, copies the body, opens Zoho, finds the thread, pastes and sends.
5. **Optionally**: after sending, Dave updates the Sheet status column (F) to `quoted`, `customer`, etc. The agent doesn't do this — only Dave can confirm the conversation progressed.

To view all pending drafts from the terminal: `node scripts/reply-agent.js --show-drafts`

---

## Hot-lead vs batched digest behavior

| Condition | Behavior |
|-----------|----------|
| `positive` intent + `high` keyword confidence | Immediate email notification on the same hourly run |
| Everything else (question, objection, neutral) | Queued; included in once-daily batched digest |
| `negative` or `stop` intent | No draft; Sheet status → `do not contact`; unsubscribe flag set |
| `auto_reply` intent | Silently skipped; no draft, no Sheet update |

The digest fires at most once per calendar day (tracked in `config/reply-agent-state.json → lastDigestSentAt`). It fires on the first hourly run of the day that has pending drafts — typically 4am. Replies arriving later the same day appear in the next day's digest or trigger a hot-lead alert if positive.

---

## Cron install (Mac)

Schedule: every hour from 4am through 7pm Mountain time.

```
0 4-19 * * * cd /path/to/Website-Master && /usr/local/bin/node scripts/reply-agent.js >> logs/reply-agent.log 2>&1
```

**To install**: `crontab -e` → paste the line above with the real path → save.

**DST note**: cron follows the Mac's system clock. Mountain Time shifts automatically between MST (UTC-7) and MDT (UTC-6) as long as the Mac's timezone is set to "Mountain Time (US & Canada)". No code change needed for daylight saving.

**Mac-asleep caveat**: cron only fires when the Mac is awake. A sleeping Mac silently misses that hour's run with no catch-up. To ensure reliable coverage, keep the Mac awake during the 4am–7pm window (`caffeinate -i` in a terminal, or set Display Sleep to Never in System Settings). Do not try to solve this in code — it's an OS-level constraint.

**Log file**: each run appends to `logs/reply-agent-{date}.log`. With 16 runs/day the log is fully auditable.

---

## Isolated cost budget

Reply-agent has its **own** cost cap, tracked in `config/reply-agent-config.json`, completely separate from Checker's $3/mo budget and Diagnoser's $5/mo budget.

Default cap: **$5/mo** (adjust `costCapMonthly`).

When the cap is hit, the agent stops making Claude calls for the rest of the month, continues to poll IMAP and log, and prints `COST CAP REACHED — drafting paused for the month.` in the log. The cap resets automatically on the first run of a new calendar month.

Costs are also recorded to the shared `config/cost-log.json` under the service tag `reply_agent` so they appear in the morning reporter's MTD cost section.

Empty runs (no new replies) cost **$0** — the IMAP poll is free and the keyword classifier is free. Claude is only called when a genuinely new, un-drafted reply needs a gap-selling response.

**Gap economics** (`avgJobValue`, `missRatePct`, `proofPoint` in config): fill these for concrete number-based cost framing in drafts. While null/empty, Claude uses qualitative language only and logs `INFO: gap economics unset — Claude will use qualitative framing`. The drafts still work; numbers make them stronger.

---

## Google Sheet status sync

### Auto-transitions (agent sets these automatically)

| Event | Sheet status set |
|-------|-----------------|
| Email reply received (any intent except opt-out/auto-reply) | `replied` |
| `stop` or `negative` intent detected | `do not contact` + unsubscribed=TRUE |
| Reply arrives before sheet-log.js ran (no row exists) | Creates new row, sets above status |

### Manual transitions (Dave sets by hand)

| Status | When |
|--------|------|
| `quoted` | After sending a price or proposal |
| `customer` | After deal closes / payment received |
| `lost` | After a genuine no, or cold after a quote |

The agent never sets `quoted`, `customer`, or `lost` — these are owner judgment calls.

### Status hierarchy — only upgrade, never downgrade

`sent` → `replied` → `quoted` → `customer`

`do not contact` is terminal. The agent never demotes `customer` or `do not contact` to a lower status, even if a new reply arrives.

### Notes column (P) — additive, never overwritten

The agent appends a terse timestamped line on every reply event, e.g.:
- `2026-06-30 replied, type assertive (low confidence), intent positive, draft queued`
- `2026-06-30 opt-out (stop), set do not contact`

Prior notes are always preserved. The trail is cumulative.

### Proposal for Dave: `can't reach` status

Consider adding a `can't reach` status (distinct from `lost`) for leads that never reply across the full drip sequence and are not opt-outs. `lost` implies an actual conversation that ended in a no; `can't reach` means the channel failed. Do not add this to the live vocabulary until Dave confirms — keeps the status set clean.

---

## Dedup — two layers (release-critical)

Dedup is load-bearing because the agent runs 16×/day. Without it, every run re-drafts the same inbox and burns both the queue and the cost cap.

**Layer 1 — IMAP message-ID set** (`config/reply-agent-state.json → processedMessageIds`): checked inside the IMAP fetch loop before any classification or API call. Updated in-memory and persisted to disk *before* the main processing loop begins, so a crash mid-processing won't cause re-drafts on the next run.

**Layer 2 — Draft queue scan** (`.some(d => d.messageId === messageId)`): secondary check in case the state file was manually reset or corrupted. If a draft for that message-ID already exists in the queue, skip silently.

**Own-email guard**: if the `From:` address matches `ZOHO_EMAIL`, the message is skipped immediately (prevents processing Zoho's own reflected mail or delivery notifications).

**Verifying dedup across two consecutive runs**: run the agent once, note the count of processed IDs in `config/reply-agent-state.json`. Run again immediately. The second run should report `0 new replies to process` and the processed ID count should be unchanged. This verifies both layers are working.

---

## Thread state (multi-touch)

When Claude drafts a reply, the prior exchange history is written to `messages/{leadId}-sent.json` under the `reply_thread` array (additive — existing sent.json fields are preserved):

```json
"reply_thread": [
  {
    "messageId": "...",
    "receivedAt": "...",
    "intent": "question",
    "bodySnippet": "first 200 chars of their reply (quoted lines stripped)",
    "agentDraftId": "leadId_timestamp",
    "agentDraftSnippet": "first 200 chars of the agent's draft"
  }
]
```

On the next reply from the same lead, `loadThread(leadId)` returns this history and the last 3 exchanges are included in the Claude prompt. This means Claude knows the conversation history and can draft a response that continues the thread rather than restarting from zero.

---

## Overlap with mobile.js

`mobile.js` handles `status === 'positive'` replies by sending a booking response (calendar slots + /start link) immediately. `reply-agent.js` independently drafts a gap-selling reply for the same reply.

**These serve different purposes and are not in conflict:**
- `mobile.js` → fires the immediate slot-offer reply (already built, already working)
- `reply-agent.js` → drafts a gap-selling conversation response for Dave's review

Dave will receive two things for a hot lead:
1. mobile.js auto-sends the slot offer
2. reply-agent puts a gap-selling draft in the queue

Dave decides whether to also send the gap-selling draft (if the slot offer didn't get a response, or to deepen the conversation). This is documented here so Dave isn't confused by the dual behavior. No code change is needed to either script to handle this overlap.

---

## Edit-diff logging (path to graduation)

Every draft in `messages/reply-drafts-queue.json` stores:
- `agentDraftedVersion`: the exact body Claude wrote (immutable, never updated)
- `sentVersion`: placeholder for Dave to optionally paste what he actually sent

Over time, comparing `agentDraftedVersion` vs `sentVersion` across many sends reveals how much Dave edits the agent's drafts, which types and intents he edits most, and whether the gap-selling framing lands without changes.

**This edit history is the evidence base for ever turning on `autoSend`.** Without it, graduation is a guess. When the edit rate on a specific bucket (e.g., positive + assertive + high-confidence) drops to near zero over 30+ sends, that bucket may be a candidate for auto-send. Until then, `autoSend: false`.

To record a sent version: after Dave sends an email, he can paste the final body into the `sentVersion` field in the queue JSON. This is optional but valuable for building the evidence base.

---

## Graduation scope (future — do NOT enable in this session)

Two-phase path, all gated by `autoSend: true` in config (currently false):

**Phase 1 — Green-light bucket (eligible for auto-send):**
- High keyword classification confidence (`high`)
- Routine intents: `positive`, `question`
- High personality type confidence (`high`)
- Sufficient edit-diff history showing near-zero edits for this bucket

**Always manual, even after full graduation:**
- `stop` / `negative` / `objection` intents (already no-draft)
- Low personality type confidence (`low`)
- Any reply containing legal language, pricing negotiation, complaints, or anger
- Anything the keyword classifier flags as `neutral`
- First reply from any new lead (always review first contact)

**Rationale**: domain reputation for trevoadvisors.com is new. One bad autonomous send to a buyer cannot be recalled. Gate the risky slice, let the routine slice auto-send only after the edit-diff history earns it.

---

## Files created

| File | Purpose |
|------|---------|
| `scripts/reply-agent.js` | Main agent script |
| `config/reply-agent-config.json` | Config + cost cap + gap economics (Dave fills) |
| `config/reply-agent-state.json` | Auto-created on first run; stores processed IDs + digest timestamp |
| `messages/reply-drafts-queue.json` | Auto-created on first run; stores all drafts |
| `logs/reply-agent-{date}.log` | Auto-created per day; 16 runs/day are auditable |

## Files NOT modified

`mobile.js`, `reply-classifier.js`, `poller.js`, `checker.js`, `diagnoser.js`, `reporter.js`, `state.json` — zero changes to existing pipeline files.

---

## Known limitations

- **`sentVersion` not auto-populated**: Dave must manually paste sent text into the queue JSON for edit-diff logging. A future Zoho API integration (OAuth) could capture sent mail automatically.
- **Digest timing**: the daily digest fires on the first hourly run of the day that has pending drafts (typically 4am). Replies arriving after that run appear in the next day's digest unless they trigger a hot-lead alert.
- **No Zoho Drafts**: drafts live in a local JSON queue, not in Dave's Zoho Drafts folder. See Step 0 above for the reason. A future phase could add Zoho OAuth.
- **Body extraction**: the agent strips quoted lines by removing `>` prefixes and `On ... wrote:` headers. Unusual MIME structures (multipart/alternative with only HTML) may result in an empty body snippet; in that case Claude classifies from the subject line alone and notes this in the draft.
- **Sheet must be initialized first**: reply-agent creates new Sheet rows when needed, but the `SentLog` tab must exist (created by running `node scripts/sheet-log.js` at least once). If the tab doesn't exist, Sheet updates are silently skipped.

---

## How Dave runs it

```bash
# Check what's pending without running a poll
node scripts/reply-agent.js --show-drafts

# Preview a run (no API calls, no writes, no emails)
node scripts/reply-agent.js --dry-run

# Normal run (poll + draft + notify)
node scripts/reply-agent.js

# Install cron (edit path first)
crontab -e
# Add: 0 4-19 * * * cd /path/to/Website-Master && /usr/local/bin/node scripts/reply-agent.js >> logs/reply-agent.log 2>&1
```

**After receiving the daily digest**: open Zoho → find the prospect's thread → paste the draft body → send. Done. Do not hit Reply in the digest email — that sends to yourself.
