# Piper — portfolio cashflow agent

**Status: scope document, not built.** No code in this directory yet. This file exists
so the spec isn't lost the way four other referenced `session-*.md` files were found
missing from this repo during an earlier audit — see root `CLAUDE.md` / the standing
action-items memory.

**Type:** advisor only — reads and reports, never acts.
**Sibling pattern:** Merlin (`merlin/`). Headless scheduled run, dated report to repo,
email delivery via Zoho SMTP.
**Name:** placeholder. Alternatives considered: Cash, Vance, Ledger.

---

## What it is

One place that answers: how much is the portfolio making, how much is it burning, and
how long can it run.

Right now spend is scattered across vendor dashboards, a cost-tracker log, and
subscriptions nobody is auditing. Revenue will shortly be scattered across Stripe and
Printify. Nothing aggregates them, and no single number tells you whether the portfolio
is getting cheaper or more expensive to operate.

Piper is deliberately boring. It reads, it counts, it reports. It does not forecast,
recommend, or move money.

---

## Scope boundary — read this before building

**In scope:** business cashflow across the venture portfolio — Trevo Advisors,
Techs4Tatas, Reeve, and any venture that later has real costs or revenue.

**Out of scope, permanently:**
- Personal finances and household budgeting
- MAVEN, trading capital, brokerage balances, or any investment position
- Tax preparation or tax advice
- Anything involving a bank account connection

MAVEN and Piper never share a config, a report, a data store, or a runtime. Trading
capital and business cashflow are different money with different rules, and merging
them is how a bad decision gets made in one domain using a number from the other.

---

## Data sources

| Source | What it provides | Access |
|---|---|---|
| Stripe | revenue, refunds, fees, subscription MRR | restricted read-only key |
| `config/cost-log.json` | actual logged spend via cost-tracker.js | local file |
| `merlin/config/unit-costs.json` | vendor unit rates | local file |
| Manual subscriptions file | flat monthly costs not captured by cost-tracker | new file, hand-maintained |
| Printify / Etsy | Techs4Tatas revenue | deferred to v2 |

**Known gap to state plainly in every report:** `cost-log.json` only reflects spend that
already called a `recordX()` function. Flat subscriptions, one-off purchases, and any
vendor without instrumentation are invisible to it. That is why the manual subscriptions
file exists, and why Piper reports "tracked spend," never "total spend."

---

## Capabilities

### v1 — actuals only

1. **Consolidated cashflow** — revenue in, spend out, net, for the period.
2. **Per-venture breakdown** — Trevo, Techs4Tatas, Reeve as separate lines plus a
   consolidated total. Costs shared across ventures (Anthropic API, hosting) get
   allocated by a documented rule, and the rule appears in the report.
3. **Runway** — months remaining at current burn, against a cash-on-hand figure Dave
   enters manually. Stated as a range, not a point.
4. **Subscription audit** — every recurring cost, what it is for, which venture, and
   when it was last actually used. Flags anything paid for with no recorded usage in
   30 days. This is the feature most likely to pay for the build.
5. **Burn trend** — month over month, direction and magnitude. Three months minimum
   before reporting a trend at all.
6. **Unit economics** — cost per lead, cost per reply, cost per booked call, CAC. Each
   one gated: reports "insufficient data — n=X" until the denominator is large enough
   to mean anything.

### v2 — deferred

- Printify and Etsy revenue for Techs4Tatas
- Per-product margin on apparel
- Revenue concentration warnings once there is more than one customer
- Simple forecasting, only after six months of actual history

---

## Reporting

- **Cadence:** weekly. Monthly is too slow to catch a subscription you forgot; daily is
  noise at this volume.
- **Delivery:** email via Zoho SMTP plus a dated markdown file in `piper/reports/`, same
  as Merlin.
- **Format:** terse, bullet-pointed, sentence case, no emojis.
- **Lead with three numbers:** net cashflow for the period, tracked monthly burn,
  runway range.
- **Quiet mode:** if nothing material changed and nothing is flagged, the email is
  three lines. A weekly report that always looks urgent gets ignored within a month.

---

## Initial restrictions — non-negotiable

**Financial safety**
- **Advisor only.** Reads and reports. Never charges, refunds, cancels, transfers, or
  modifies anything.
- **Read-only credentials only.** Stripe restricted key with read scope. No write
  scopes exist in the config, so no code path can accidentally use one.
- **No bank connection.** No Plaid, no Teller, no aggregator. Cash on hand is entered
  manually. This is the single largest risk surface available and v1 does not touch it.
- **No payment method on file** anywhere in Piper's own infrastructure.

**Epistemic**
- **Actuals only. No projections in v1.** With this little revenue history, a forecast
  is a guess wearing a suit.
- **Denominator on every derived metric.** CAC off one deal is not CAC. Report
  "insufficient data — n=1."
- **Distinguish tracked from total.** Piper reports what it can see and states what it
  cannot.
- **Never infer revenue from pipeline state.** A lead marked hot is not money.
  `status: closed` in `state.json` has never meant a won deal in this pipeline's
  history — it has always been a data-quality rejection. Piper reads revenue from
  Stripe and nowhere else.

**Operational**
- Runs headless on schedule, same pattern as Merlin.
- Actor mode stubbed as `PIPER_ACTOR`, unimplemented, default off — placeholder only,
  so the boundary is explicit in code.
- Isolated directory. Zero modification to existing files. Reads `cost-log.json` and
  `unit-costs.json` without writing to either.
- Additive only if it ever needs to touch shared state.

---

## Build sequence

**Phase 0 — audit before writing**
Read `cost-tracker.js`, `config/cost-log.json`, `merlin/config/unit-costs.json`, and
Merlin's report generator. Report what already exists. Merlin already does cost
estimation and email delivery — Piper may be an extension of Merlin's reporting layer
rather than a new agent. Decide that before building.

**Phase 1** — manual subscriptions file plus subscription audit. No API access needed,
and it is the feature most likely to find money immediately.

**Phase 2** — Stripe read-only integration, revenue and MRR.

**Phase 3** — consolidated report, runway, email delivery.

**Phase 4** — unit economics, gated behind sample-size checks.

Phase 1 is genuinely useful on its own and requires no credentials. If the build stalls
after Phase 1, it was still worth doing.

---

## Honest assessment

First several reports will read: revenue $0, tracked burn roughly $1.28 per month,
runway indefinite. That is not a failure of the agent — it is an accurate picture, and
the accuracy is the point.

The feature that earns its keep before revenue exists is the **subscription audit**.
Six ventures, a long vendor list, and several tools that were set up and never used.
That is where money is quietly leaking, and it is findable today.

Everything else in this spec is measurement built ahead of the thing being measured.
Defensible, but worth naming.
