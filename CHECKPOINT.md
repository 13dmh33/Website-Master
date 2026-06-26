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
