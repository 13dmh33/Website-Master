# Scout has-website mode — checkpoint

**Branch:** `feature/scout-has-website` (off `main` — this repo has no `master`).
**Status:** Done. Tests + lint green. Not merged.

## What changed

`scripts/scout.js` is now a thin CLI orchestrator with a `--mode no-website|has-website` flag
(defaults to `no-website`, fully backward compatible — no flag = identical behavior to before).
The filter/scoring logic that used to live inline in `scout.js` was extracted into:

- `scripts/lib/scout-shared.js` — `slugify`, `channelForTrade`, `isSocialOnlySite` (unchanged, verbatim).
- `scripts/lib/scout-no-website.js` — `scoreGap`, `filterAndFormatNoWebsite`, `exportToCsv`. Verbatim
  extraction of the original logic — no byte changed in the algorithm itself.
- `scripts/lib/scout-has-website.js` — new mode: `isRealWebsite`/`isPlatformOnlyUrl`, `scoreFit`,
  `filterAndFormatHasWebsite`, `exportAuditorCsv`, `exportNeedsEmailCsv`.

### Regression lock (no-website mode)
- `scripts/test/fixtures/scout-raw-results.json` — mocked Outscraper raw results.
- `scripts/test/fixtures/scout-no-website.golden.json` — golden output, generated once by running
  the verbatim-extracted `filterAndFormatNoWebsite` against the fixture (i.e. captured *before* any
  further refactor changed call sites), `scraped_at` stripped for stability.
- `scripts/test/scout-no-website.test.js` asserts the function reproduces the golden fixture exactly,
  plus dedup and min-score behavior.

### has-website mode (`scripts/lib/scout-has-website.js`)
- **Filters:** reviews 10+ (no ceiling), rating 4.0+, phone required, real (non-social/non-platform)
  website required. HVAC is blocked upstream by the existing CLI trade validation (shared with
  no-website mode, unchanged).
- **`isRealWebsite`** rejects Facebook/Instagram/Yelp-biz/Nextdoor/Thumbtack/Linktree/Google-Business
  URLs — a broader list than no-website's `isSocialOnlySite` on purpose (kept as a *separate* function
  so no-website's filter/regex never changes).
- **`fit_score`**: review band (200+=4, 75-199=3, 25-74=2, 10-24=1) + rating bonus (4.8+=+2, 4.5-4.79=+1).
  No website/email component — that scoring belongs to the no-website mode's `gap_score` only.
- **Email routing:** a real-site lead with no email is never discarded — it goes to `needsEmail` and is
  written to `needs-email-*.csv` for manual contact-page lookup. Only leads *with* email land in the
  auditor-ready CSV/JSON.
- **Output:** `leads-web/{city}-{trade}-{date}-run{n}.json` (full record incl. `site_url`, `fit_score`),
  `leads-web/{city}-{trade}-{date}-run{n}.csv` (auditor-ready: `business_name,trade,city,url,email` —
  feeds straight into `/audit/input/leads.csv`), `leads-web/needs-email-{city}-{trade}-{date}-run{n}.csv`
  when there are no-email leads.
- **Dedup:** has-website mode dedups against both `leads-web/*.json` (its own history) and `leads/*.json`
  (no-website's leads) by `place_id`, so the same contractor is never scraped/contacted from both segments.
  no-website mode's dedup is unchanged — still only checks `leads/*.json`.

### Shared budget, separate qualify-rate history
- `config/scout-config.json` gained two new fields, additive only: `total_raw_has_website`,
  `total_qualifying_has_website`. Existing `total_raw`/`total_qualifying` (no-website) are untouched.
- `spent_this_month` / `monthly_cap` / `total_runs` remain shared across both modes (one $10/mo cap).
- `--target` is mode-aware: it computes the qualify rate from the active mode's own history only.
- `--dry-run` works identically in both modes and exits before any API call, file write, or config write.

## Tests

`node --test "scripts/test/*.test.js"` — 17/17 passing:
- `scout-no-website.test.js` — golden-fixture regression, scraped_at sanity, dedup, min-score.
- `scout-has-website.test.js` — `isRealWebsite` (social/platform rejection incl. Linktree/Google-Business),
  `scoreFit` band boundaries (9 excluded / 10 included / no ceiling at 1500; rating bonus bands),
  review-floor filtering, social/platform never qualifying, HVAC pass-through (blocked upstream not here),
  `site_url` capture, dedup, `fit_score` on a real record, no-email routing to `needsEmail` (never dropped),
  both CSV exporters' exact column headers.

Lint: `node --check` on `scripts/scout.js` and every new `lib`/`test` file — all pass.

Manual verification (this session, container — no Outscraper key available):
- `node scripts/scout.js --dry-run --city "Denver, CO" --trade plumber --force` → unchanged no-website
  dry-run output, config untouched.
- `node scripts/scout.js --dry-run --city "Denver, CO" --trade plumber --mode has-website --force` →
  has-website dry-run output, config untouched.
- Mocked-data run of `filterAndFormatHasWebsite` against the fixture, piped through `exportAuditorCsv`/
  `exportNeedsEmailCsv`, confirmed correct CSV shape and routing.

## Follow-up: domain dedup + Enricher hookup (this session, additive)

- **Domain dedup**: `scout-shared.js` gained `normalizeDomain(url)` (lowercase host, strips
  protocol/`www.`). `scout.js` gained `loadKnownDomains()` (reads `site_url` across all of
  `leads-web/*.json`). `filterAndFormatHasWebsite` takes an optional 6th arg `knownDomains` and
  also tracks domains seen earlier in the *same* run, so a franchise/relisted business sharing a
  site across two different `place_id`s is caught either way. No-website mode is untouched (no
  website field to dedup on). 3 new tests added (known-domain match, same-run duplicate, www/protocol
  normalization) — 20/20 passing.
- **Enricher hookup**: Scout's has-website mode now also writes `needs-email-*.json` (same basename
  as the CSV) alongside the CSV, since Enricher works off JSON, not CSV. `scripts/enricher.js` gained
  `--mode has-website`: scans `leads-web/needs-email-*.json`, runs the same Apollo `/v1/people/match`
  lookup, and on a hit moves the record into the corresponding `leads-web/{basename}.json` (auditor-ready
  array) and regenerates `leads-web/{basename}.csv` via `exportAuditorCsv` — no `queue/*-brief.json`
  upgrade (has-website leads don't have one). On a miss, marks `enriched_at` in place to avoid repeat
  credit burn, same as no-website mode. Default `--mode no-website` behavior is byte-for-byte unchanged.
  Manually verified via a dry-run fixture in this container (no real Apollo key available).

## What's left

- Not yet run against the real Outscraper/Apollo APIs (no keys in this container — same constraint
  documented for Scout/Pitcher/Drip/Reporter/Webhook/Poller/Enricher; must run on Mac).
- `leads-web/` is a new directory, not yet `.gitignore`'d or explicitly tracked-by-rule — it will be
  tracked by default (same as `leads/`) the first time a real run writes into it.
- Not merged to `main`. Not wired into Diagnoser/Pitcher/Mobile — has-website leads currently only feed
  `/audit` via the CSV; they don't enter `state.json`'s queue (`updateState` is still no-website-only,
  intentionally, since the has-website pitch path isn't built yet).

## How to resume

1. Get a real Outscraper run on Mac: `node scripts/scout.js --city "<city>" --trade plumber --mode has-website --budget 0.25 --force --csv`
   (CSV here is automatic for has-website mode regardless of `--csv` flag — `--csv` flag only adds the
   no-website `reports/` export; has-website's auditor CSV always writes alongside the JSON).
2. Spot-check `leads-web/*.csv` against real listings, then feed it into `/audit/input/leads.csv` to test
   the diagnostic agent end-to-end with real has-website leads.
3. Decide on merge timing once both `feature/scout-has-website` and `feature/site-audit` have been run
   live and vetted.
