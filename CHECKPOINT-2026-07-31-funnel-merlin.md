# CHECKPOINT — session 2026-07-31, funnel accuracy + Merlin self-correction

**Branch:** `feature/funnel-audit-and-merlin-accuracy` (off `main`)
**Source prompt:** Merlin 2026-07-31 nightly, "Add a real STRIPE_SECRET_KEY…"
**Status:** all committed, tree clean, safe to stop.

Two naming notes. The branch is deliberately not `feature/add-stripe-key` as
the prompt specified — Phase 0 found that task void, so the name would have
described work that does not exist. And this is a dated checkpoint rather than
`CHECKPOINT.md`, which is an existing 23KB Sheet-Log document; the repo already
uses per-session files (`CHECKPOINT-branch-reconcile-2026-07-19.md`).

---

## Phase 0 audit — premises checked before starting

| Queue item | Premise | Verdict |
|---|---|---|
| Task 0 — add STRIPE_SECRET_KEY, replace placeholder Payment Links | Links are placeholders; a secret key is needed | **False, skipped.** Live Payment Links since `6db94f9`; no code anywhere reads `STRIPE_SECRET_KEY`, and Payment Links are Stripe-hosted so none is required |
| 1 — investigate checked→sent drop-off (510 leads) | 510 leads lost, 29.6% conversion | **True but misleading.** Only 24 could ever send |
| 2, 3 — unstick frozen drip stages | An operational step is not running | **True, confirmed.** Drip is scheduled nowhere |
| 4 — fix 9 Nora adversarial-audit defects | The audit exists with 9 findings | **Not verified — not started** |

---

## Done

**1. Merlin was recommending finished work, with no way to notice** — `feda731`
Two independent bugs. `repo-facts.js` had no resolver for `add_stripe_key`, so
unlike the four items it correctly retires, this one could never be detected as
done and would have led every nightly report indefinitely. Separately,
`session-prompt.js` front-loaded any `non_code_blocker` as "Task 0" without
checking `executor` — this candidate is `executor: 'dave'`, so it opened a
session headed "this session executes these" with work the agent cannot do,
and the slice that removes Task 0 from the queue also dropped it out of Dave's
list, so the one person who could act on it never saw it. Both fixed, 3
regression tests. The stale setup comment in `website/checkout/index.html` that
made the task look unfinished is corrected too.

**2. The backlog number was pointing at the wrong fix** — `3b53f37`
"510 leads lost" decomposes as: 208 with no brief file (nothing to send), 242
on channel `sms` (never delivered once), 36 email awaiting approval, and **24
email + approved — the only ones that could send. 4.7%.** The raw count also
drove `daysToClearBacklogAtCurrentCap`, which read ~17 days of pending work
when the truth is under one day at the existing cap of 30 (27 sent the prior
day). It pointed at throughput; the real constraint is supply of email-capable
approved leads. Added `computeActionableBacklog()` to `scripts/lib/funnel.js`,
wired through the snapshot and report. Verified live: 24/510, days-to-clear
17 → 1.

**3. Merlin can now be told it was wrong** — `f2810dd` (requested mid-session)
```
node merlin/feedback.js <candidate-id> <verdict> "note"
node merlin/feedback.js --accuracy | --list
```
`already-done` / `wrong-premise` / `not-worth-it` suppress a candidate on
future runs; `good` records a hit so accuracy is not measured only from
complaints; `reinstate` lifts a suppression. Append-only — repeat misses on the
same id count separately, because three stale nights are three misses.
Suppression is checked after resolvers and decisions so the strongest evidence
is the reason shown. Report gained a "Merlin accuracy" section. Seeded with
today's two real verdicts. 9 tests.

**4. Drip's daily budget was going entirely to a dead channel** — `d811558`
The due queue was in `readdirSync` order, sliced to `daily_limit`. Today 130
were due (58 email, 72 sms) and **all 20 slots went to sms** — every send would
have failed — while 58 deliverable email follow-ups waited, the oldest 22 days
past due and days from the 26-day sweep that retires them unanswered. Now
round-robin across channels, most-overdue-first within each, encoding nothing
about which channel is currently healthy. Verified live: 20 sms / 0 email →
10 email / 10 sms. 6 tests.

Also committed to `main` before branching: `f9242e8`, the 07-30 and 07-31
pipeline runs, so live `state.json` / `cost-log.json` were never carried across
a branch operation.

---

## Not done

**Queue item 4 — Nora's 9 audit defects.** Premise unverified: earlier sessions
deferred the Nora adversarial audit to a fresh session, so the 9 findings may
not exist yet. Verify the audit exists before scheduling remediation. Merlin
scores this lowest of the code items (revenue proximity 2) since no lead moves
toward paid until Nora has a live customer.

---

## Needs Dave — decisions, not code

1. **Drip is scheduled nowhere.** Not in cron, not in launchd, not called by
   `daily-lead-gen.sh` — which is why 17 leads sat at `drip_d1_sent` since
   2026-07-09 and will be swept dead around 2026-08-04 having never received
   steps 2–4 of a sequence they were enrolled in. Automating it means real
   outbound mail on a schedule, so it is not a change to make unilaterally.
   Options: wire into the 6:30am job, run it manually, or accept that
   follow-ups stop at step 1.
2. **58 email follow-ups are due right now** and will not send until drip runs.
   `node scripts/drip.js --dry-run --force --channel email` previews them
   safely.
3. **Should drip keep attempting SMS at all** while A2P is unapproved? Today 72
   of 130 due were sms. Ordering now prevents starvation, but half the budget
   still goes to attempts that fail.
4. **`main` is 9 commits ahead of origin** and has been unpushed all week.

---

## Verification

```
node scripts/test/funnel.test.js        # 13 passing
node scripts/test/drip-order.test.js    #  6 passing
for f in merlin/test/*.test.js; do node "$f"; done   # 9 files passing
node merlin/feedback.js --accuracy      # scorecard
node scripts/drip.js --dry-run --force  # sends nothing
```
