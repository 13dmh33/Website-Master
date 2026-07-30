# Missy — Dave's job-hunt pipeline

Missy is a personal, **review-only** job-search agent. Once a day (or twice) she
pulls fresh job postings from public sources, filters and scores them against
your resume and preferences, tailors a truthful resume + cover letter for the
best matches, and emails you a digest to act on manually. She logs everything to
a Google Sheet you control.

**She never applies to anything.** No auto-apply, no submitting to any job site,
ever. The only outbound action is emailing the digest to you.

---

## Status (as of 2026-07-17)

**Built and verified working end-to-end** — real Adzuna pulls, free rules
filter, Haiku scoring, Sonnet tailoring, digest preview, all confirmed against
Dave's real resume with no fabricated claims.

**Live:**
- Resume ingested, `preferences.md` set to Dave's real target (director/sr.
  manager/VP across national accounts, sales, sales planning, finance,
  strategy; $160k+ base; favor tech/HVAC/AI/large corporations)
- `ANTHROPIC_API_KEY`, `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` configured
- Google Sheet tracker live — writes to a **"Jobs" tab inside "Trevo Propsect
  list"** (shared with the service account via "anyone with the link can
  edit"), not a dedicated Missy-only sheet. Feedback calibration is active.

**Not yet live:**
- Email sending — `ZOHO_SMTP_*` unset, digest previews to terminal only.
  Point it at Gmail (`smtp.gmail.com`, an App Password for the target inbox)
  or any other SMTP provider whenever ready.

**Bugs found and fixed this round** (all covered by regression tests in
`npm test`, 10/10 passing):
- JSON parser choked on unescaped control characters in long Markdown
  tailoring output (was crashing tailoring on ~37% of top matches)
- Scoring prompt now weights title/seniority mismatch into the numeric fit
  score, not just the rationale (was scoring a step-below-target posting 87/100)
- Tailoring prompt blocks pairing a verified fact with an unverified adjacent
  one in the same phrase/bullet
- Near-dup merge now collapses "remote" postings listed under different
  cities (was producing duplicate digest entries for the same role)
- `jobId()` prefers Adzuna's stable ad id over its `redirect_url`, which can
  carry a per-request tracking token — was silently breaking "nothing repeats
  in a digest" and defeating the score cache for Adzuna-sourced jobs
- Haiku scores are now cached across runs (fingerprinted on profile +
  preferences) — a job already scored isn't re-sent to Haiku on a later run
- `cache_control` added to the repeated profile+preferences prefix on both
  scoring and tailoring calls — safe no-op below the model's cache minimum,
  real savings above it

---

## What she does, in order

1. **ingest** — parse your resume into `data/master-profile.json` and scaffold
   `inputs/preferences.md`. (Run once; re-run when your resume changes.)
2. **scout** — pull postings from Greenhouse, Lever, and Ashby boards for the
   companies you list, plus Adzuna keyword searches and (optional) USAJobs.
   Normalize, record the real posted date, drop anything older than 21 days,
   and dedup so nothing repeats.
3. **filter** — a free rules pass: drop deal-breakers, location/remote
   mismatches, and obvious seniority mismatches before spending anything.
4. **score** — Claude Haiku rates fit 0-100. A freshness bonus is added on top
   (+15 if posted in the last 2 days, +8 under a week, +3 under two weeks) so a
   fresh good-enough role outranks a stale slightly-better one. Keeps everything
   at or above your minimum score.
5. **tailor** — Claude Sonnet writes a tailored resume + short cover letter for
   the top matches, using only real content from your resume. Written to
   `out/<date>/<company>-<title>/` as both `.docx` and `.md`.
6. **report** — build the digest, email it to you, and append a row per match
   to the Google Sheet tracker.

## Truthfulness

Tailoring only reorders, reweights, and rephrases what is already in your
resume. It never invents employers, titles, dates, degrees, or metrics. If a
posting wants a skill you do not have, it is left out — never faked. The digest
even shows which of the posting's key terms your resume genuinely covers, and
which were omitted.

---

## First-time setup

1. **Drop your resume** in `inputs/` as `master-resume.docx` or
   `master-resume.pdf`.
2. **Install and parse:**
   ```sh
   cd job-hunter
   npm install
   npm run ingest      # parses the resume, scaffolds preferences.md, prints a summary
   ```
3. **Edit `inputs/preferences.md`.** The fenced ```config block is the important
   part — fill in the ATS slugs for companies you want to track, your search
   queries, locations, comp floor, and deal-breakers. Everything outside that
   block is free text that Claude reads as your real preferences.
4. **Add your keys** — copy `.env.example` to `.env` and fill in what you have.
   Anything left blank just disables that feature (the run tells you what it
   skipped), so you can start partial:
   - `ANTHROPIC_API_KEY` — required for scoring and tailoring.
   - `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` — free tier at developer.adzuna.com.
   - `USAJOBS_API_KEY` / `USAJOBS_EMAIL` — optional, federal jobs only.
   - `ZOHO_SMTP_*` + `DIGEST_TO` — to email the digest (you already have Zoho).
   - `GOOGLE_SERVICE_ACCOUNT_JSON` + `SHEET_ID` — the tracker sheet.
5. **Dry-run first:**
   ```sh
   npm run daily -- --dry-run
   ```
   This pulls, filters, scores, and prints a digest preview — but sends no
   email, writes no sheet rows, and changes no state. Use it to sanity-check
   your preferences before going live.

## Running for real

```sh
npm run daily
```

Flags:
- `--dry-run` — preview only, no email / sheet / state changes.
- `--limit N` — cap how many jobs get tailored (default 8).
- `--min-score N` — override the minimum blended score (default 70).

## Testing

Three layers, cheapest first:

1. **Offline logic (no keys, runs anywhere):**
   ```sh
   npm test
   ```
   Checks the pieces that must be exactly right — freshness ranking, the age
   cutoff, dedup/near-dup merge, the rules filter, and .docx rendering.

2. **The Claude path (needs only `ANTHROPIC_API_KEY`):**
   ```sh
   npm run ingest        # once, to parse your resume
   npm run test:claude   # scores + tailors ONE built-in sample job
   ```
   Validates scoring and tailoring against your real resume without any live
   job source. Costs a few cents. Open the files it writes to `out/test-claude/`
   and confirm every claim traces back to your actual resume.

3. **Full pipeline dry-run (needs source keys):**
   ```sh
   npm run daily -- --dry-run
   ```
   Pulls real postings, filters, scores, tailors the top matches, and prints
   the digest preview — but sends no email, writes no sheet rows, and changes no
   state. Run it twice in a row to confirm nothing repeats. This is the closest
   thing to a real run; when it looks right, drop `--dry-run`.

## Twice-daily cron on your Mac

Missy is built for a twice-daily cadence (fresh posts stand out via the "new
since last run" flag). Add to your crontab (`crontab -e`) to run at 7am and 4pm:

```cron
0 7,16 * * *  cd /path/to/Website-Master/job-hunter && /usr/bin/env node src/index.js >> logs/cron.log 2>&1
```

Or for a single 7am run:

```cron
0 7 * * *  cd /path/to/Website-Master/job-hunter && /usr/bin/env node src/index.js >> logs/cron.log 2>&1
```

(If you prefer launchd over cron on macOS, point a `.plist` at the same command.)

---

## The Google Sheet is the tracker of record

Columns: `date | company | title | location | score | url | status | notes`

`status` is **your** manual field: `new` / `reviewing` / `applied` / `passed` /
`interview`. Missy reads your recent `applied` / `passed` / `interview` rows and
feeds a few back into the scorer as examples, so over time her scoring tracks
your real taste instead of scoring statically. On a fresh sheet with no marked
rows, this is simply skipped.

## Recency is a ranking signal, not just a filter

Timing drives callback odds, so fresh postings are prioritized. The digest shows
both the raw fit and the freshness bonus for every match, so the ranking is
always explainable. Postings older than `MAX_AGE_DAYS` (21) never reach scoring.

## Optional instant alert

Set `INSTANT_ALERT_MIN` (e.g. `85`) in `.env` and Missy will fire a one-off
email the moment a job is both high-fit and posted in the last 24 hours, instead
of waiting for the next digest. Off by default.

---

## Where this runs

Other tools in this repo assume network-facing stages need Dave's Mac because
the remote container's outbound access is restricted — that assumption does
**not** hold for Missy: real Adzuna pulls, Claude scoring/tailoring calls, and
Google Sheets writes have all been run successfully from a remote/container
session. If a future session hits connectivity errors on these calls, verify
before assuming Mac-only — don't take this claim as settled either way, since
proxy/network config can differ between environments and sessions.

## Sources and coverage

Greenhouse, Lever, Ashby, and Adzuna cover most modern finance/sales roles.
Adzuna also re-syndicates listings from many other boards (including some
Workday-hosted ones), so large-employer coverage isn't zero even without a
dedicated Workday integration.

**Workday is intentionally not built**, not just deferred. `src/sources/
workday.js` remains a no-op stub. Researched 2026-07-16: Workday exposes an
unauthenticated JSON endpoint per tenant
(`{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`), but their
Terms of Service and End User Agreement explicitly prohibit crawling/scraping
their sites — this isn't a published, sanctioned public API the way
Greenhouse's is. Same standard applied to **LinkedIn** and **Indeed** (login
walls / ToS) — not scraped, not planned.

## Layout

```
job-hunter/
  inputs/       master-resume.*  (yours; gitignored) + preferences.md
  data/         master-profile.json (generated; gitignored)
                career-context.md — Dave's career-coach brief (positioning, vetted
                  accomplishments, resume methodology, open-items checklist)
                resume-baselines/{sales-planning,finance,national-accounts}.md —
                  last-approved resume per archetype, used to diff new drafts against
                career-coach-drafts.json — pending/approved/rejected career-coach drafts
  out/          tailored resume + cover letter per match (generated; gitignored)
                out/<date>/career-coach/<slug>/ — review.md, interview-prep.md,
                  resume.docx/cover-letter.docx (only after approval)
  logs/         daily run logs (gitignored)
  state.json    append-only dedup ledger (gitignored)
  scripts/
    approve-tailor.js    approve/reject a career-coach draft (writes the real .docx)
    interview-prep.js    on-demand interview prep for an already-tailored job
  src/
    index.js    orchestrator (npm run daily)
    ingest.js scout.js filter.js scorer.js tailor.js career-coach.js reporter.js
    lib/        config, state, recency, dedup, claude, sheets, email, docx,
                career-coach-store, ...
    sources/    greenhouse, lever, ashby, adzuna, usajobs, workday(stub)
```

## Career-coach (2026-07-29)

A second, separate step alongside the automatic `tailor.js` resume generation
above — this one re-ranks the day's matches against your own career-context
brief (`data/career-context.md`, not the auto-parsed resume), which is allowed
to disagree with the scorer's own fit ranking. Only the top 1-3 get a draft,
and nothing becomes a real `.docx` until you approve it:

```bash
node scripts/approve-tailor.js               # list pending drafts
node scripts/approve-tailor.js --show <id>   # view the full draft (diff, gaps, open items)
node scripts/approve-tailor.js <id>          # approve -> writes resume.docx/cover-letter.docx
node scripts/approve-tailor.js <id> --reject # reject, nothing written

node scripts/interview-prep.js <id>          # once an interview is scheduled — likely
                                              # questions, STAR stories, gap talking points,
                                              # questions to ask them. On-demand, not cron.
```

The highlighted diff (added/removed vs. the last approved resume for the same
archetype) and gap analysis show up in the daily digest email for the top
picks, not just in local files.
