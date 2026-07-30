# Strategist Agent — Reeve Business Intelligence

**Scope correction (2026-07-29):** this file previously claimed "Reeve and Milly" monitoring
and listed a "Milly → DM trigger rate" metric below. Confirmed by reading the source directly:
`strategist.js` never had a Milly data path — only `REEVE_DIR` was ever defined. That was a
documentation error, not a capability that regressed. Fixed here; the Milly metric row below
is marked accordingly. Reeve-side monitoring is real and working — its data-loading and metric
functions were extracted into `strategy/lib/reeve-metrics.js` the same day so Merlin (see
`merlin/CLAUDE.md`'s `--reeve` flag) can reuse them instead of re-implementing the same logic.

## Role

The Strategist is a permanent monitoring agent for the Reeve business system. It has no opinion, no ego, and no loyalty to past decisions. Its job is to read the actual data, apply market benchmarks, and tell the truth about what the numbers say.

It runs two modes:
1. **Monitor** (weekly, zero API cost) — reads pipeline data, outputs health metrics, flags alerts
2. **Recommend** (on demand, zero API cost) — pricing analysis, model recommendations, risk flags

The Strategist does not build features. It tells you what to build and why, based on data.

## Current business context

**Milly** = free acquisition engine. Posts 4x/week on Instagram → attracts freelance speakers → funnels them to Reeve.
**Reeve** = the product speakers pay for. Currently built as done-for-you agency tooling (Dave-operated). May evolve to self-serve SaaS.

**Goal:** Drive revenue by users. Not by Dave's hours.

## Monitoring cadence

| Cadence | Script | What it checks |
|---------|--------|----------------|
| Weekly (Mon) | `node strategy/agents/strategist.js --monitor` | Pipeline health, conversion rates, MRR, alerts |
| On pricing change | `node strategy/agents/strategist.js --pricing` | Full pricing model analysis against current data |
| On client milestone | `node strategy/agents/strategist.js --client <id>` | Individual client ROI and retention risk |

## Key metrics tracked

| Metric | Target | Alert threshold |
|--------|--------|----------------|
| MRR | Growing 10%/mo | Flat for 4 weeks |
| Client conversion rate (leads → paying) | >15% | <8% |
| Pitch acceptance rate | >20% | <10% |
| Client retention (monthly) | >90% | <80% |
| Avg bookings confirmed per client/mo | >0.5 | 0 for 60 days |
| ~~Milly → DM trigger rate~~ | ~~Growing~~ | **NOT YET WIRED — no Milly data path exists in `strategy/lib/reeve-metrics.js` or anywhere in this agent. Milly's own engagement data lives in `milly/lib/instagram-insights.js` / `milly/lib/ab-tracker.js`; wiring this row would mean reading those directly, not something this agent does today.** |

## Pricing model monitoring

The Strategist tracks whether the current price structure matches the value delivered. If bookings confirmed per client per month consistently exceeds 1, pricing is too low. If client churn within 90 days exceeds 30%, pricing is too high relative to perceived value.

## Output files

All reports saved to `strategy/reports/`:
- `monitor-YYYY-MM-DD.json` — weekly health snapshot
- `pricing-YYYY-MM-DD.md` — pricing analysis (human-readable)
- `alerts-YYYY-MM-DD.json` — triggered alerts with recommended actions
