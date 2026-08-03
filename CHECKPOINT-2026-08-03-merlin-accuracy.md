# CHECKPOINT — session 2026-08-03, Merlin accuracy + drip backlog audit

**Branch:** `main` (see "Production was on a branch" below for why not a feature branch)
**Source prompt:** Merlin 2026-08-03 nightly, "Investigate the checked -> sent drop-off"
**Status:** all committed, tree clean, safe to stop.

---

## Phase 0 audit

| Queue item | Premise | Verdict |
|---|---|---|
| 1 — investigate checked→sent drop-off (566 lost) | The biggest measured leak, cause unknown | **Already done 2026-07-31.** That investigation produced `computeActionableBacklog`; today's own report prints the answer four lines below the recommendation |
| 2 — unstick frozen `drip_d1b_sent` (1 lead) | An operational step isn't running | **Not frozen.** Correctly queued for d1c; see below |
| 3 — fix 9 Nora adversarial-audit defects | The audit exists with 9 findings | **False.** No audit doc anywhere in `nora/`. Recorded as `wrong-premise` |

---

## Production was on a branch — fixed first

The 6:30am cron runs whatever is checked out, and the working tree was on
`feature/funnel-audit-and-merlin-accuracy` with **8 unmerged commits** —
including the guard that stops tomorrow's 59-contact batch from sending 30 and
silently discarding 29. Any checkout of `main` would have reverted drip
automation and that guard with no error. Merged to `main` first; tests green
there (funnel 13, drip-order 6, merlin 9 files).

---

## Done

**1. Merlin no longer re-raises a drop-off its own report explains** — `5bdeaa3`
`investigate_biggest_dropoff` is regenerated from the funnel every run, so it
recurs forever and led the report twice in three days. Feedback cannot fix it:
`good` does not suppress (correct — the finding was real), and `already-done`
would suppress a genuinely new drop-off later. The gate is therefore
structural: when at least half a stage is blocked for reasons already measured
and printed, the gap is arithmetic, not a conversion leak. If the blocked share
falls — SMS goes live, orphaned records get re-diagnosed — the candidate
returns on its own, which a test asserts. Also recorded `nora_remediation` as
`wrong-premise`.

**2. Queue item 2 answered: the stage is not frozen** — investigation, no code change
Lead `a-better-plumber-denver-co`, initial email 2026-06-29, d1 and d1b both
sent 2026-07-09, nothing since. Not suppressed, not opted out, brief intact,
templates present, and it correctly evaluates as due for d1c. It has not moved
because **drip's first automated run was this morning** — before today it was
scheduled nowhere. It is competing for 20 daily slots against a large backlog.
`markUnresponsive` also cannot retire it: that sweep requires d2 to have been
sent, so a lead that never received d1c/d2 stays live indefinitely rather than
aging out. That is defensible on its own, but see below.

---

## Needs Dave — a messaging decision, not a bug

Measuring the whole drip queue turned up the real finding behind item 2:

```
total due right now: 288
  on time (<7d late)      27
  1-2 wks late            82
  2-4 wks late            66
  over 4 wks late        113
days to drain at 20/day:  15
```

**91% of due follow-ups are late, and 39% are more than a month late.** The
sequence is designed as day 4 / 8 / 12 / 19, but a lead first contacted on
2026-06-29 will now receive its "day 12" note on day 35 and its breakup on day
40-plus, after a month of silence. Draining takes about 15 days at the current
cap, during which the late ones get later.

Sending a sequence weeks out of order is a brand decision, not something to
change silently in code. Three options:

1. **Send them anyway** (current behaviour) — steps arrive badly out of order.
2. **Skip stale steps** — a lead past `dead_after_days` jumps straight to the
   d2 breakup, then retires. Fewer, better-timed messages.
3. **Retire quietly** — anything past `dead_after_days` with no reply is marked
   unresponsive without further sends, and the queue drops to roughly the 27
   genuinely-current ones.

Option 2 is the one I would pick: it still closes the loop with every prospect,
but does not pretend a five-week-old thread is a day-12 check-in. It needs a
change to `markUnresponsive` plus a step-skip in `loadDripQueue`.

---

## Also outstanding

- **`main` is unpushed** — now 12 commits ahead of origin.
- Merlin's ranked pool is nearly empty: after this session only `dmarc_tighten`
  (Dave, low priority) survives. Worth noting the standing backlog is largely
  cleared rather than reading an empty queue as a fault.

---

## Verification

```
node scripts/test/funnel.test.js        # 13 passing
node scripts/test/drip-order.test.js    #  6 passing
for f in merlin/test/*.test.js; do node "$f"; done   # 9 files, 18 in ranking
node merlin/feedback.js --accuracy      # 33.3% (1 good, 2 off)
```
