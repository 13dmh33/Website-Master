# CHECKPOINT — Contact-Page Email Scraper

Branch: `feature/contact-page-scraper` (off `main`)
Date: 2026-06-29
Status: ✅ Built, unit-tested, container-tested. Needs a real run on the Mac for live email results.

## What was built

`scripts/contact-scraper.js` — a zero-API-cost script that visits the websites of
has-website leads and extracts a publicly visible email, flipping SMS-only leads into
email-capable leads so the existing email pipeline can use them. Free alternative to
Apollo (Enricher): no paid API, no credit cap. New file only — **no existing pipeline
file was modified.**

## How it actually works (important — differs from the original spec)

The original task assumed `email` and `channel` live on the lead in `state.json`. They
do not. In this codebase:

- A lead's `email` lives in its record inside `leads/*.json`.
- `channel` is **not stored** — `diagnoser.js` derives it at diagnose time:
  `channel = lead.email ? 'email' : (lead.phone ? 'sms' : lead.channel)` (diagnoser.js:308).

So to make an SMS-only lead email-capable, the scraper:

1. Writes the scraped email into that lead's `leads/*.json` record — **additive**, only
   fills an empty `email` field, never overwrites an existing one. Also tags
   `email_source: "contact-scraper"`.
2. Resets that lead's `state.json` status to `scouted` so **Diagnoser re-runs and
   regenerates an email-appropriate brief**. (The existing SMS brief's `cold_message` is a
   ≤160-char SMS template, not an email — re-diagnosis is required, not a channel flip.)
   The prior status is preserved additively as `preScrapeStatus`, plus `scrapedEmailAt`.

This matches Dave's documented run order exactly: **scraper → Diagnoser → Checker → Pitcher**.
Leads where no email is found are left **completely untouched** (still SMS).

## How to run

```bash
# On the Mac (real results — container egress is proxy-blocked, see below)
node scripts/contact-scraper.js              # real run, writes emails + rewinds status
node scripts/contact-scraper.js --dry-run    # find emails, write nothing (safe preview)
node scripts/contact-scraper.js --limit 20   # cap sites visited this run

# Then the normal pipeline:
node scripts/diagnoser.js
node scripts/checker.js
node scripts/pitcher.js --channel email
```

Politeness/safety built in: browser User-Agent, 10s per-request timeout, 1.5s delay between
sites, homepage + up to 3 contact-ish sub-pages only, every fetch wrapped in try/catch (one
bad site never crashes the run), http→https retry.

## Real run against current `state.json` (container, 2026-06-29)

```
Queue: 229 leads
  skipped (sent/closed):     48
  already have email:        0
  no website to scrape:      170   ← no-website-mode leads, nothing to scrape
  no lead record found:      0
  → eligible to scrape:      11
sites visited: 8 (--limit 8)
emails found: 0
leads flipped→email: 0
fetch errors: 8   ← ALL errored: container outbound proxy blocks arbitrary sites
```

**The selection logic is correct and proven** — it found the 11 has-website / no-email leads
and correctly excluded the 170 no-website leads and 48 sent/closed. The fetches all errored
because the container's outbound proxy only allowlists package registries + Anthropic (the
same reason Scout runs on the Mac). **Run on the Mac to get real emails.**

## Parsing logic — unit-tested (proves extraction works without live fetch)

Tested against a fixture page. Results:
- Extracts both `mailto:` and plain-text addresses.
- Junk filter correctly drops `support@squarespace.com`, `noreply@example.com`, and a
  Sentry hex address; keeps real ones.
- `pickBest` correctly chose `jim@wright-jones.com` (domain-matching, personal) over the
  role address `office@…` and a non-matching `tina@wrightjones.com`.
- Contact-link detection found about/contact/team pages, capped at 3.
- Handles both website field names (`site_url` from sheet-import, `website` from Scout).

## Leads needing manual attention

- **170 leads have no website** (`no-website` mode). This scraper can't help them — they
  still need Apollo (Enricher) or manual sheet curation for email.
- The **11 has-website / no-email leads** are the real target set; run on the Mac to see how
  many flip. Expect a partial hit rate — sites that JS-obfuscate or image-encode their email,
  or sit behind Cloudflare challenges, will return nothing (logged, lead left unchanged).

## Not done / out of scope
- Did not run live (container egress blocked) — Mac run pending.
- No JS rendering (static HTML only) — obfuscated emails won't be caught by design.
