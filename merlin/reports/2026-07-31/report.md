# Merlin nightly report — 2026-07-31

Advisor-only. This report recommends; it does not act. Nothing here has modified code,
branches, configs, or sent outreach.

## Recommendation

**Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs**

The post-call-proposal pipeline is fully built and tested end to end except for this — a real key turns a finished feature into revenue capability with zero code changes.

This scored highest under the fixed rubric (revenue proximity weighted 3x above build volume — a hard rule, not a per-run preference). This is a zero-build, don't-build recommendation: the highest-value move right now is not writing more code.

Two session prompts are attached separately (primary, ~5h; light alternate, ~2h) — both are paste-ready, no editing required.

## Your list — what needs you

2 items need you — a browser, a vendor dashboard, or a phone. Nothing here can be automated away.

1. **Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs** (score 24.0)
   The post-call-proposal pipeline is fully built and tested end to end except for this — a real key turns a finished feature into revenue capability with zero code changes.
2. **Tighten DMARC to p=quarantine once clean report cycles confirm it is safe** (score 3.0)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

## Repo health

- Main vs origin: 8 ahead, 1 behind.
- 8 local branches — 3 stale (14+ days), 3 unpushed.
- Untracked top-level directories: job-hunter — confirm each is intentional.

## Funnel state

Biggest drop-off: checked -> sent, 510 leads lost (29.6% conversion).
Stalled stages (frozen since previous run): drip_d1_sent (17 waiting), drip_d1b_sent (1 waiting).
  scouted: 833
  diagnosed: 726
  checked: 724
  sent: 214
  drip_d1_sent: 18
  drip_d1b_sent: 1
  drip_d1c_sent: 0
  drip_d2_sent: 0
  replied: 0
  hot: 0

## Resolved / settled since last run (Merlin no longer recommends these)

**Already done (verified against live repo state + all branches — not re-recommended):**
- ~~Decide on and execute a merge plan for feature/nora-multichannel-config and feature/funnel-metrics~~ — Already done: both nora/ and scripts/lib/funnel.js are present on the checked-out main.
- ~~Wire reply-classifier.js into poller.js so email replies write "replied" into state.json like SMS already does~~ — Already done: scripts/poller.js references reply-classifier (email replies are now classified into state.json).
- ~~Revert checker-config.json / diagnoser-config.json daily_limit back to 30 (currently elevated)~~ — Already done: checker daily_limit=30, diagnoser daily_limit=30 (both at/under the documented normal of 30).
**Settled by a standing decision (not re-recommended):**
- ~~Enable IMAP for dave@trevoadvisors.com in Zoho Mail settings~~ — decision "zoho-imap-enabled" (2026-07-27): IMAP is enabled for dave@trevoadvisors.com. Stop recommending it.
- ~~Clear the 510-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing~~ — decision "backlog-is-arithmetic" (2026-07-19): The checked-but-unsent backlog is arithmetic and channel-blocked, not a quality leak or a fresh discovery.

## Data-integrity caveats (read before trusting the numbers above)

- [high] status: "closed" in state.json has never meant a won deal in this pipeline's history — every observed occurrence has been a data-quality rejection. Do not read a closed count as revenue.
- [low] Apollo hit-rate instrumentation exists but has never been exercised — Enricher has not been run for real since it shipped. Apollo ROI figures below are not yet meaningful.

## Apollo hit rate

Phone-only: 0 attempted, 0 hits (n/a).
Has-website: 0 attempted, 0 hits (n/a).

## Cost audit (estimates, assumptions listed)

Actual logged spend this month (2026-07): $1.84 — this repo's own cost log, not a vendor dashboard.
Cost per positive-signal outcome: n/a — zero leads have reached "replied" or "hot" this month (see the biggest-dropoff finding), so cost-per-outcome is undefined, not zero.
- apollo_subscription: $0 (inactive) — APOLLO_API_KEY is not configured in this environment — subscription not counted (would be $49/mo if activated).
- twilio_sms: $0 (inactive) — Zero SMS sent this month (Twilio A2P 10DLC not yet approved, per the standing action-items memory) — projected cost is $0 until sends resume.

Assumptions:
- Actual spend is read from this repo's own cost-tracker.js log (config/cost-log.json), not a vendor dashboard — it reflects only activity that already called a recordX() function.
- Projections use merlin/config/unit-costs.json rates, editable by Dave if a rate drifts from the real vendor price.
- Zoho email and any other flat-subscription tools are not itemized as marginal pipeline spend.

## Backlog — full ranked candidate list (nothing not chosen is lost)

1. **[RECOMMENDED]** Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs (score 24.0, revenue 8/10, build 0/10, ~0.25h)
   The post-call-proposal pipeline is fully built and tested end to end except for this — a real key turns a finished feature into revenue capability with zero code changes.

2. Investigate the checked -> sent drop-off (510 leads lost, 29.6% conversion) before building anything new (score 21.0, revenue 7/10, build 0/10, ~0.5h)
   This is the single biggest measured leak in the funnel. Understanding why (capacity limit vs. genuine drop-off vs. measurement artifact — see the pipeline snapshot's integrity flags) is higher-value than building new lead sources on top of a leaky funnel.

3. Unstick the "drip_d1_sent" stage — 17 leads have sat there with zero movement since the previous run (18 reached, unchanged) (score 18.0, revenue 6/10, build 0/10, ~0.5h)
   Unlike a one-time drop-off, this stage is not leaking — it is frozen: no lead advanced past "drip_d1_sent" between the last two runs despite 17 waiting. That usually means an operational step isn't running (a cron that never fires, a Mac-only script never invoked) rather than a conversion problem. Find the un-run step before building anything new.

4. Unstick the "drip_d1b_sent" stage — 1 leads have sat there with zero movement since the previous run (1 reached, unchanged) (score 18.0, revenue 6/10, build 0/10, ~0.5h)
   Unlike a one-time drop-off, this stage is not leaking — it is frozen: no lead advanced past "drip_d1b_sent" between the last two runs despite 1 waiting. That usually means an operational step isn't running (a cron that never fires, a Mac-only script never invoked) rather than a conversion problem. Find the un-run step before building anything new.

5. Tighten DMARC to p=quarantine once clean report cycles confirm it is safe (score 3.0, revenue 1/10, build 0/10, ~0.25h)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

6. Fix the 9 defects found in the Nora adversarial audit before any real contractor uses it live (score 1.0, revenue 2/10, build 5/10, ~3h)
   Safety-critical (Nora can escalate on the first missed call or go silently dark per customer) but zero current lead moves toward paid until Nora has a live customer — build volume without near-term revenue.

---

Generated by Merlin. Advisor only — reads and writes its own reports/prompts, nothing else.
