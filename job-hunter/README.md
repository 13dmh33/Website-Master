# Missy — Dave's job-hunt pipeline

Missy is a personal, **review-only** job-search agent. Once a day (or twice) she
pulls fresh job postings from public sources, filters and scores them against
your resume and preferences, tailors a truthful resume + cover letter for the
best matches, and emails you a digest to act on manually. She logs everything to
a Google Sheet you control.

**She never applies to anything.** No auto-apply, no submitting to any job site,
ever. The only outbound action is emailing the digest to you.

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

Like the other outbound tools in this repo, the network-facing stages (pulling
jobs, calling Claude, sending email, writing the sheet) run on **Dave's Mac** —
the remote container's outbound access is restricted, so live pulls and API
calls are blocked there. `ingest` and all the offline logic run anywhere.

## Sources and coverage

Greenhouse, Lever, Ashby, and Adzuna cover most modern finance/sales roles.
Large industrial employers (e.g. Daikin) often use **Workday**, which needs a
per-tenant endpoint — `src/sources/workday.js` is a deliberate stub, left for a
later phase when a specific named employer justifies it. LinkedIn and Indeed are
**not** scraped (login walls, terms of service).

## Layout

```
job-hunter/
  inputs/       master-resume.*  (yours; gitignored) + preferences.md
  data/         master-profile.json (generated; gitignored)
  out/          tailored resume + cover letter per match (generated; gitignored)
  logs/         daily run logs (gitignored)
  state.json    append-only dedup ledger (gitignored)
  src/
    index.js    orchestrator (npm run daily)
    ingest.js scout.js filter.js scorer.js tailor.js reporter.js
    lib/        config, state, recency, dedup, claude, sheets, email, docx, ...
    sources/    greenhouse, lever, ashby, adzuna, usajobs, workday(stub)
```
