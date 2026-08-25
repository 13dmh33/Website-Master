# Merlin nightly report — 2026-08-05

Advisor-only. This report recommends; it does not act. Nothing here has modified code,
branches, configs, or sent outreach.

## Recommendation

**Audit why Miley (Techs4Tatas) is not pulling all catalog items, and fix the pull**

Miley generates content for a real product business, but its catalog pull is incomplete — scripts/scrape-catalog.js gets a 403 from techs4tatas.printify.me on every server-side fetch path (anti-bot, not a container egress issue), so the product set it writes posts about is partial or stale. Establish what is actually missing and why before judging post quality: content graded against an incomplete catalog will point at the wrong fixes. Sequence matters — this comes before miley_post_quality_audit.

This scored highest under the fixed rubric (revenue proximity weighted 3x above build volume — a hard rule, not a per-run preference). Build volume: 3/10.

Two session prompts are attached separately (primary, ~5h; light alternate, ~0.25h) — both are paste-ready, no editing required.

## Your list — what needs you

1 item need you — a browser, a vendor dashboard, or a phone. Nothing here can be automated away.

1. **Tighten DMARC to p=quarantine once clean report cycles confirm it is safe** (score 3.0)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

## Repo health

- Main vs origin: 22 ahead, 3 behind.
- 10 local branches — 6 stale (14+ days), 5 unpushed.
- Untracked top-level directories: job-hunter — confirm each is intentional.

## Funnel state

Biggest drop-off: checked -> sent, 507 leads lost (39.8% conversion).
Actionable backlog: 19 of 507 leads at 'checked' can actually send (3.7%).
  Blocked: 205 have no brief file (nothing to send); 283 on channel 'sms' (has never delivered).
  Read the 507 as reach, not as pending work — throughput is not the constraint when 19 can move.
Stalled stages: none — every stage with waiting leads advanced at least one since the previous run.
  scouted: 943
  diagnosed: 844
  checked: 842
  sent: 335
  drip_d1_sent: 88
  drip_d1b_sent: 33
  drip_d1c_sent: 0
  drip_d2_sent: 0
  replied: 0
  hot: 0

## Merlin accuracy

Accuracy across all recorded feedback: 33.3% (1 good, 2 off, 3 rated).
Reasons it was off: already-done x1, wrong-premise x1.
Record new feedback with: node merlin/feedback.js <candidate-id> <verdict> "note"

## Resolved / settled since last run (Merlin no longer recommends these)

**Already done (verified against live repo state + all branches — not re-recommended):**
- ~~Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs~~ — Already done: website/checkout/index.html carries 2 live Stripe Payment Link(s). Payment Links are Stripe-hosted, so no STRIPE_SECRET_KEY is required — no code in this repo reads one.
- ~~Decide on and execute a merge plan for feature/nora-multichannel-config and feature/funnel-metrics~~ — Already done: both nora/ and scripts/lib/funnel.js are present on the checked-out main.
- ~~Wire reply-classifier.js into poller.js so email replies write "replied" into state.json like SMS already does~~ — Already done: scripts/poller.js references reply-classifier (email replies are now classified into state.json).
- ~~Revert checker-config.json / diagnoser-config.json daily_limit back to 30 (currently elevated)~~ — Already done: checker daily_limit=30, diagnoser daily_limit=30 (both at/under the documented normal of 30).
**Settled by a standing decision (not re-recommended):**
- ~~Enable IMAP for dave@trevoadvisors.com in Zoho Mail settings~~ — decision "zoho-imap-enabled" (2026-07-27): IMAP is enabled for dave@trevoadvisors.com. Stop recommending it.
- ~~Clear the 507-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing~~ — decision "backlog-is-arithmetic" (2026-07-19): The checked-but-unsent backlog is arithmetic and channel-blocked, not a quality leak or a fresh discovery.
**Corrected by session feedback (Merlin got these wrong):**
- ~~Fix the 9 defects found in the Nora adversarial audit before any real contractor uses it live~~ — wrong-premise: No Nora adversarial audit exists — no audit doc in nora/, no 'adversarial' file anywhere. There are no 9 findings to remediate; the audit itself has never been run, so remediation is premature. (recorded 2026-08-03)

## Data-integrity caveats (read before trusting the numbers above)

- [high] status: "closed" in state.json has never meant a won deal in this pipeline's history — every observed occurrence has been a data-quality rejection. Do not read a closed count as revenue.
- [low] Apollo hit-rate instrumentation exists but has never been exercised — Enricher has not been run for real since it shipped. Apollo ROI figures below are not yet meaningful.

## Apollo hit rate

Phone-only: 0 attempted, 0 hits (n/a).
Has-website: 0 attempted, 0 hits (n/a).

## Cost audit (estimates, assumptions listed)

Actual logged spend this month (2026-08): $0.87 — this repo's own cost log, not a vendor dashboard.
Cost per positive-signal outcome: n/a — zero leads have reached "replied" or "hot" this month (see the biggest-dropoff finding), so cost-per-outcome is undefined, not zero.
- apollo_subscription: $0 (inactive) — APOLLO_API_KEY is not configured in this environment — subscription not counted (would be $49/mo if activated).
- twilio_sms: $0 (inactive) — Zero SMS sent this month (Twilio A2P 10DLC not yet approved, per the standing action-items memory) — projected cost is $0 until sends resume.

Assumptions:
- Actual spend is read from this repo's own cost-tracker.js log (config/cost-log.json), not a vendor dashboard — it reflects only activity that already called a recordX() function.
- Projections use merlin/config/unit-costs.json rates, editable by Dave if a rate drifts from the real vendor price.
- Zoho email and any other flat-subscription tools are not itemized as marginal pipeline spend.

## Backlog — full ranked candidate list (nothing not chosen is lost)

1. **[RECOMMENDED]** Audit why Miley (Techs4Tatas) is not pulling all catalog items, and fix the pull (score 6.0, revenue 3/10, build 3/10, ~2h)
   Miley generates content for a real product business, but its catalog pull is incomplete — scripts/scrape-catalog.js gets a 403 from techs4tatas.printify.me on every server-side fetch path (anti-bot, not a container egress issue), so the product set it writes posts about is partial or stale. Establish what is actually missing and why before judging post quality: content graded against an incomplete catalog will point at the wrong fixes. Sequence matters — this comes before miley_post_quality_audit.

2. Audit and improve Miley (Techs4Tatas) post quality once the catalog pull is complete (score 5.0, revenue 3/10, build 4/10, ~3h)
   Review what the pipeline is actually producing — hooks, captions, visual variety, product coverage, whether the brand voice holds across the rotation — and improve the generator against real output rather than assumptions. Deliberately scheduled after miley_catalog_pull_audit: grading posts while the product data feeding them is incomplete would mistake a data gap for a content problem.

3. Tighten DMARC to p=quarantine once clean report cycles confirm it is safe (score 3.0, revenue 1/10, build 0/10, ~0.25h)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

---

Generated by Merlin. Advisor only — reads and writes its own reports/prompts, nothing else.
