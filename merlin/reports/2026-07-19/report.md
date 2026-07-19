# Merlin nightly report — 2026-07-19

Advisor-only. This report recommends; it does not act. Nothing here has modified code,
branches, configs, or sent outreach.

## Recommendation

**Clear the 436-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing**

436 leads are already Checker-approved and waiting — every one of them is closer to paid than any lead that doesn't exist yet. At the current 30/day cap this takes 15 days; zero new code required either way. This is currently the single largest lever available.

This scored highest under the fixed rubric (revenue proximity weighted 3x above build volume — a hard rule, not a per-run preference). This is a zero-build, don't-build recommendation: the highest-value move right now is not writing more code.

Two session prompts are attached separately (primary, ~3.45h; light alternate, ~1.25h) — both are paste-ready, no editing required.

## Repo health

- Main vs origin: 0 ahead, 0 behind.
- 12 local branches — 1 stale (14+ days), 3 unpushed.
- Untracked top-level directories: job-hunter — confirm each is intentional.

## Funnel state

Biggest drop-off: checked -> sent, 436 leads lost (30% conversion).
  scouted: 636
  diagnosed: 625
  checked: 623
  sent: 187
  drip_d1_sent: 18
  drip_d1b_sent: 1
  drip_d1c_sent: 0
  drip_d2_sent: 0
  replied: 0
  hot: 0

## Data-integrity caveats (read before trusting the numbers above)

- [medium] poller.js does not write "replied" into state.json for email replies the way webhook.js does for SMS — email replies are undercounted in this snapshot's funnel numbers.
- [high] status: "closed" in state.json has never meant a won deal in this pipeline's history — every observed occurrence has been a data-quality rejection. Do not read a closed count as revenue.
- [low] checker-config.json daily_limit is 120, above the documented normal value of 30 — confirm this elevated cap is still intentional.
- [low] diagnoser-config.json daily_limit is 100, above the documented normal value of 30 — confirm this elevated cap is still intentional.
- [low] Apollo hit-rate instrumentation exists but has never been exercised — Enricher has not been run for real since it shipped. Apollo ROI figures below are not yet meaningful.

## Apollo hit rate

Phone-only: 0 attempted, 0 hits (n/a).
Has-website: 0 attempted, 0 hits (n/a).

## Cost audit (estimates, assumptions listed)

Actual logged spend this month (2026-07): $1.28 — this repo's own cost log, not a vendor dashboard.
Cost per positive-signal outcome: n/a — zero leads have reached "replied" or "hot" this month (see the biggest-dropoff finding), so cost-per-outcome is undefined, not zero.
- apollo_subscription: $0 (inactive) — APOLLO_API_KEY is not configured in this environment — subscription not counted (would be $49/mo if activated).
- twilio_sms: $0 (inactive) — Zero SMS sent this month (Twilio A2P 10DLC not yet approved, per the standing action-items memory) — projected cost is $0 until sends resume.

Assumptions:
- Actual spend is read from this repo's own cost-tracker.js log (config/cost-log.json), not a vendor dashboard — it reflects only activity that already called a recordX() function.
- Projections use merlin/config/unit-costs.json rates, editable by Dave if a rate drifts from the real vendor price.
- Zoho email and any other flat-subscription tools are not itemized as marginal pipeline spend.

## Backlog — full ranked candidate list (nothing not chosen is lost)

1. **[RECOMMENDED]** Clear the 436-lead checked-but-unsent backlog — run Pitcher daily (already scheduled) or raise the daily cap if speed matters more than pacing (score 27.0, revenue 9/10, build 0/10, ~0.1h)
   436 leads are already Checker-approved and waiting — every one of them is closer to paid than any lead that doesn't exist yet. At the current 30/day cap this takes 15 days; zero new code required either way. This is currently the single largest lever available.

2. Add a real STRIPE_SECRET_KEY and replace placeholder Payment Link URLs (score 24.0, revenue 8/10, build 0/10, ~0.25h)
   The post-call-proposal pipeline is fully built and tested end to end except for this — a real key turns a finished feature into revenue capability with zero code changes.

3. Investigate the checked -> sent drop-off (436 leads lost, 30% conversion) before building anything new (score 21.0, revenue 7/10, build 0/10, ~0.5h)
   This is the single biggest measured leak in the funnel. Understanding why (capacity limit vs. genuine drop-off vs. measurement artifact — see the pipeline snapshot's integrity flags) is higher-value than building new lead sources on top of a leaky funnel.

4. Enable IMAP for dave@trevoadvisors.com in Zoho Mail settings (score 18.0, revenue 6/10, build 0/10, ~0.1h)
   Unblocks two already-finished pieces of code (Reply Agent, post-call-proposal Drafts delivery) with zero further engineering — pure unlock, no new surface area.

5. Wire reply-classifier.js into poller.js so email replies write "replied" into state.json like SMS already does (score 9.0, revenue 4/10, build 3/10, ~1.5h)
   Fixes a measurement gap, not a sales gap — improves report accuracy but does not by itself move any lead closer to paid.

6. Decide on and execute a merge plan for feature/nora-multichannel-config and feature/funnel-metrics (score 7.0, revenue 3/10, build 2/10, ~1h)
   Both are complete and tested but invisible to every other branch until merged — low revenue proximity on its own (no lead moves), but unblocks future sessions cheaply.

7. Revert checker-config.json / diagnoser-config.json daily_limit back to 30 (currently elevated) (score 6.0, revenue 2/10, build 0/10, ~0.05h)
   A one-line config fix, not a build — trivial effort, low but nonzero integrity value.

8. Tighten DMARC to p=quarantine once clean report cycles confirm it is safe (score 3.0, revenue 1/10, build 0/10, ~0.25h)
   Deliverability hygiene, not a sales lever — low priority until the trigger condition (clean report cycles) is actually met.

9. Fix the 9 defects found in the Nora adversarial audit before any real contractor uses it live (score 1.0, revenue 2/10, build 5/10, ~3h)
   Safety-critical (Nora can escalate on the first missed call or go silently dark per customer) but zero current lead moves toward paid until Nora has a live customer — build volume without near-term revenue.

---

Generated by Merlin. Advisor only — reads and writes its own reports/prompts, nothing else.
