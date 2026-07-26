# CHECKPOINT — 2026-07-24 → 07-26

Big-arc session: unblocked the email-lead pipeline end to end, shipped CAN-SPAM
compliance + contact-keyed suppression, and stood up two new agents (PM/weekly
planner, and verified the job-hunter). Everything below is committed + pushed to
`main` unless noted.

## Shipped

- **THE Scout field bug fixed** (`671a028`, `653185f`) — Outscraper returns the
  website under `website` (Scout read `site`) and address under `address` (read
  `full_address`), so every has-website lead was discarded as "no real site."
  This is why Scout "never found email leads." Fixed via
  `scout-shared.normalizeOutscraperRows`, applied after the async-poll flatten.
- **has-website workflow gap fixed** (`d7b3602`) — needs-email leads were written
  only to `leads-web/`; now mirrored into `leads/` + registered `scouted` so
  contact-scraper and Diagnoser actually see them.
- **CAN-SPAM compliance** (`419d38d` + earlier) — `config/compliance.json` +
  `scripts/lib/compliance.js` append the required footer (ad ID + Dave's postal
  address `3390 S Emerson Dr, Englewood, CO 80113` + reply-"stop") to every email
  at send; `assertEmailCompliant()` hard-blocks sending until all three present.
- **Contact-keyed do-not-contact** (`078da6b`) — `scripts/lib/do-not-contact.js`
  keys suppression on email/phone/domain so opt-outs survive re-scrapes under a
  new lead_id; enforced at ingestion + every send lane; self-heals from state.json.
- **Checker state-gate** (`aeed9c1`) — `isCheckable()` only re-checks `diagnosed`
  leads, so Checker stops clobbering settled leads' status (un-suppressed an
  opt-out twice before this).
- **contact-scraper junk hardening** (`40aaac9`) — `scripts/lib/lead-quality.js`
  auto-rejects placeholder emails (`info@mysite.com`) + non-prospect businesses
  (supply houses / distributors / chains).

## Staged, ready — TOMORROW's action (Dave, on Mac)

- **16 approved, CAN-SPAM-compliant Austin plumber email leads**, QA'd clean.
  Send: `node scripts/pitcher.js --dry-run --force --channel email` to preview,
  then drop `--dry-run`. All 16 fit under the 30/day cap.

## Pipeline now repeatable (the day's real unlock)

`scout --mode has-website <city> <trade>` → `contact-scraper --deep` →
`diagnoser` → `checker` → `pitcher --channel email`. Austin proved it: 75 sites →
24 emails scraped free → 16 approved leads. **Dallas** is queued whenever Dave
runs the scout (his Mac).

## New agents

- **PM + Weekly-Planner agent** at `~/pm-agent/CLAUDE.md` — task sync to macOS
  Reminders ("Claude PM" list) + a rigid Sunday weekly planner built around
  Dave's real rhythm (5–8am deep block, 8–4 job, 4–8pm kids, 8–10pm light block),
  most-revenue-proximate priority, 3–4 workouts/wk (40-min office gym on office
  days), one Marco activity + family recs. Reminders-cli installed on Mac.
  Pending: connect Google Calendar + designate office days (see that CLAUDE.md).
- **Missy (job-hunter)** — verified 10/10 offline tests on branch
  `claude/job-hunter-pipeline-kbzs75`. Added `deploy/com.dave.missy.daily.plist`
  + `TURN-ON.md` (committed to that branch, NOT pushed). Only gap to daily
  digests: SMTP creds (`ZOHO_SMTP_USER/PASS` or a Gmail app password).

## Pending / needs Dave

- **227 ghost records** — phantom "checked" leads (no data anywhere) inflating
  every funnel/backlog number. Recommended: mark terminal. Needs Dave's explicit
  yes (227-row state.json edit).
- **Branch cleanup** — 21 fully-merged remote branches safe to prune; command
  ready for Dave to run (classifier blocks mass remote-delete without per-branch
  auth). See last session message.
- Standing external blockers unchanged: Twilio A2P, Stripe keys, Zoho IMAP,
  SERPAPI_KEY.

## Test status
Full `scripts/test/*` suite: 68+ passing (added scout-fields, checker-gate,
lead-quality, compliance, do-not-contact regression tests this session).
