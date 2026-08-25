# Merlin nightly report — 2026-08-25

Advisor-only. This report recommends; it does not act. Nothing here has modified code,
branches, configs, or sent outreach.

## Recommendation

**Audit and improve Miley (Techs4Tatas) post quality once the catalog pull is complete**

Review what the pipeline is actually producing — hooks, captions, visual variety, product coverage, whether the brand voice holds across the rotation — and improve the generator against real output rather than assumptions. Deliberately scheduled after miley_catalog_pull_audit: grading posts while the product data feeding them is incomplete would mistake a data gap for a content problem.

This scored highest under the fixed rubric (revenue proximity weighted 3x above build volume — a hard rule, not a per-run preference). Build volume: 4/10.

Two session prompts are attached separately (primary, ~3h; light alternate, ~0.25h) — both are paste-ready, no editing required.

## Your list — what needs you

1 item need you — a browser, a vendor dashboard, or a phone. Nothing here can be automated away.

1. **Tighten DMARC to p=quarantine once clean report cycles confirm it is safe** (score 3.0)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

## Repo health

- Main vs origin: 22 ahead, 7 behind.
- 10 local branches — 9 stale (14+ days), 5 unpushed.
- Safe to delete (stale and already merged): main.
- Untracked top-level directories: job-hunter — confirm each is intentional.

## Funnel state

Biggest drop-off: checked -> sent, 845 leads lost (30.4% conversion).
Actionable backlog: 219 of 845 leads at 'checked' can actually send (25.9%).
  Blocked: 194 have no brief file (nothing to send); 432 on channel 'sms' (has never delivered).
  Read the 845 as reach, not as pending work — throughput is not the constraint when 219 can move.
Stalled stages: none — every stage with waiting leads advanced at least one since the previous run.
  scouted: 1234
  diagnosed: 1214
  checked: 1214
  sent: 369
  drip_d1_sent: 230
  drip_d1b_sent: 171
  drip_d1c_sent: 134
  drip_d2_sent: 121
  replied: 0
  hot: 0

## Merlin accuracy

Accuracy across all recorded feedback: 25% (1 good, 3 off, 4 rated).
Reasons it was off: already-done x1, wrong-premise x2.
Record new feedback with: node merlin/feedback.js <candidate-id> <verdict> "note"

## Resolved / settled since last run (Merlin no longer recommends these)

**Already done (verified against live repo state + all branches — not re-recommended):**
- ~~Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs~~ — Already done: website/checkout/index.html carries 2 live Stripe Payment Link(s). Payment Links are Stripe-hosted, so no STRIPE_SECRET_KEY is required — no code in this repo reads one.
- ~~Decide on and execute a merge plan for feature/nora-multichannel-config and feature/funnel-metrics~~ — Already done: both nora/ and scripts/lib/funnel.js are present on the checked-out main.
- ~~Wire reply-classifier.js into poller.js so email replies write "replied" into state.json like SMS already does~~ — Already done: scripts/poller.js references reply-classifier (email replies are now classified into state.json).
- ~~Revert checker-config.json / diagnoser-config.json daily_limit back to 30 (currently elevated)~~ — Already done: checker daily_limit=30, diagnoser daily_limit=30 (both at/under the documented normal of 30).
**Settled by a standing decision (not re-recommended):**
- ~~Enable IMAP for dave@trevoadvisors.com in Zoho Mail settings~~ — decision "zoho-imap-enabled" (2026-07-27): IMAP is enabled for dave@trevoadvisors.com. Stop recommending it.
- ~~Clear the 845-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing~~ — decision "backlog-is-arithmetic" (2026-07-19): The checked-but-unsent backlog is arithmetic and channel-blocked, not a quality leak or a fresh discovery.
**Corrected by session feedback (Merlin got these wrong):**
- ~~Fix the 9 defects found in the Nora adversarial audit before any real contractor uses it live~~ — wrong-premise: No Nora adversarial audit exists — no audit doc in nora/, no 'adversarial' file anywhere. There are no 9 findings to remediate; the audit itself has never been run, so remediation is premature. (recorded 2026-08-03)
- ~~Audit why Miley (Techs4Tatas) is not pulling all catalog items, and fix the pull~~ — wrong-premise: Premise is wrong on three counts, verified 2026-08-13. (1) No 403: techs4tatas.printify.me returns HTTP 200 to both a browser UA and plain curl (111KB). (2) Not anti-bot: it is a client-rendered Next.js/turbopack app with no __NEXT_DATA__ and no JSON island, so products are simply absent from the server HTML — the scraper's parser finds nothing and says so. (3) Catalog is not partial-or-stale-because-blocked: sitemap.xml returns 200 and enumerates the FULL catalog of 8 products with ids+slugs, and the homepage HTML already carries exactly 8 matching api.printify.com/mockup/<id> URLs. Real fix is to parse sitemap.xml (one request, no puppeteer) — minutes, not the ~5h estimated. Also note the report cites scripts/scrape-catalog.js; actual path is miley/scripts/scrape-catalog.js. (recorded 2026-08-13)

## Data-integrity caveats (read before trusting the numbers above)

- [high] status: "closed" in state.json has never meant a won deal in this pipeline's history — every observed occurrence has been a data-quality rejection. Do not read a closed count as revenue.
- [low] Apollo hit-rate instrumentation exists but has never been exercised — Enricher has not been run for real since it shipped. Apollo ROI figures below are not yet meaningful.

## Apollo hit rate

Phone-only: 0 attempted, 0 hits (n/a).
Has-website: 0 attempted, 0 hits (n/a).

## Cost audit (estimates, assumptions listed)

Actual logged spend this month (2026-08): $4.04 — this repo's own cost log, not a vendor dashboard.
Cost per positive-signal outcome: n/a — zero leads have reached "replied" or "hot" this month (see the biggest-dropoff finding), so cost-per-outcome is undefined, not zero.
- apollo_subscription: $0 (inactive) — APOLLO_API_KEY is not configured in this environment — subscription not counted (would be $49/mo if activated).
- twilio_sms: $0 (inactive) — Zero SMS sent this month (Twilio A2P 10DLC not yet approved, per the standing action-items memory) — projected cost is $0 until sends resume.

Assumptions:
- Actual spend is read from this repo's own cost-tracker.js log (config/cost-log.json), not a vendor dashboard — it reflects only activity that already called a recordX() function.
- Projections use merlin/config/unit-costs.json rates, editable by Dave if a rate drifts from the real vendor price.
- Zoho email and any other flat-subscription tools are not itemized as marginal pipeline spend.

## Backlog — full ranked candidate list (nothing not chosen is lost)

1. **[RECOMMENDED]** Audit and improve Miley (Techs4Tatas) post quality once the catalog pull is complete (score 5.0, revenue 3/10, build 4/10, ~3h)
   Review what the pipeline is actually producing — hooks, captions, visual variety, product coverage, whether the brand voice holds across the rotation — and improve the generator against real output rather than assumptions. Deliberately scheduled after miley_catalog_pull_audit: grading posts while the product data feeding them is incomplete would mistake a data gap for a content problem.

2. Tighten DMARC to p=quarantine once clean report cycles confirm it is safe (score 3.0, revenue 1/10, build 0/10, ~0.25h)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

---

Generated by Merlin. Advisor only — reads and writes its own reports/prompts, nothing else.
