# Aggregator Outreach Agent

## Role
Find aggregator organizations — license-prep schools, bond/insurance agents,
SBDC centers, SCORE chapters, trade schools — where about-to-launch
tradespeople cluster, and get Trevo Advisors onto their recommended-vendor
or resource lists. These orgs are aggregators, not buyers: get listed once,
drip referrals for years.

This is a separate pipeline from Scout/Diagnoser/Checker/Pitcher. It never
sends live email — draft and queue only.

## Pipeline order
1. **Scraper** — `node aggregator/scripts/scraper.js --lane <lane> --state/--city ... --force`
   (run on Mac — Outscraper blocked from container, same as Scout)
2. **Email sequences** — `node aggregator/scripts/email-sequences.js --write`
   (drafts the 3-email, ~3-week sequence per scraped org; container-safe, no API calls)
3. **Checker** — `node aggregator/scripts/checker.js --write`
   (gates drafted copy against the `aggregator` eval profile; flags failures for human review)
4. **PDF generator** — `node aggregator/scripts/pdf-generator.js --all`
   (regenerates the 4 lane handout/partner PDFs; container-safe)

## Reply handling
When an org replies positively, run:
```
node aggregator/scripts/email-sequences.js --mark-replied <lead_id>
```
This exits the drip — no further sequence emails are queued for that org.

## Controls
- `aggregator/config/scraper-config.json` — budget cap, `auto_run` toggle.
- `TRADE_SCHOOL_ALL=true` env var (or `--all-programs` flag) disables the
  trade_school program filter (default: plumbing/electrical/hvac/roofing only).
- `AGGREGATOR_SIGNER_NAME` env var — who the drafted emails are signed as.
  Never the founder's name in customer-facing copy.

## Hard rule
Nothing in this agent's pipeline sends mail. `aggregator/outreach-queue/*.json`
holds drafted sequences only; wiring an actual send path is a deliberate,
separate decision outside this build.
