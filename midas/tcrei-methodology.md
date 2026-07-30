# Stock Review & Ranking Methodology

**Reference document — TCREI framework**
Last updated: July 28, 2026

---

## Step 0 — Bucket Assignment

The bucket is decided **before** any analysis, because it determines which rules apply.

| Bucket | Target % | How it's judged |
|---|---|---|
| Long-Term Core | 40% | 5–10 yr thesis; tolerates drawdown; no timing |
| High-Dividend | 30% | Payout safety primary; wide stops appropriate |
| Tactical | 15% | All 5 technical frameworks required; tight stop |
| Crypto | 8% | BTC/ETH primary; hard cap 15% total |
| Options | 5% | 90-day min; delta 0.5–0.7 only |

Same stock, different verdict depending on which bucket it's being considered for. A wide stop that's correct for an income core hold (XOM) is wrong for a tactical trade.

---

## Step 1 — Hard Gates (pass/fail, before scoring)

These kill an entry regardless of how good the story is. Nothing downstream overrides them.

| Gate | Fails if |
|---|---|
| R:R minimum | Below 2:1 from current price |
| RS vs SPY | Declining — disqualifies tactical entries outright |
| Earnings window | Report within 30 days |
| 52-wk high rule | Near highs without confirmed Wyckoff retest ("CEG rule") |
| Volume confirmation | Breakout volume under 40% above 50-day average |
| Sector ceiling | Ad-tech (META + ZETA) over 20% combined |
| Bucket allocation | Bucket at or over target — capital routes elsewhere first |

**This is the part that matters most.**

> **Live example — ZETA.** 18 straight beat-and-raise quarters, OpenAI partnership, analyst targets to $44 — and it still rates WAIT. At ~$19 the R:R fails 2:1, and repeated $20 breakout attempts have not confirmed on volume (June 30/July 1: ~8.7M shares vs. ~10.32M average; needed ~14M+).

---

## Step 2 — Six Analytical Layers (Mode A full report)

1. **Industry Trend** — structural 5–10 yr tailwind/headwind, institutional flow direction (13F net buying/selling), two named competitors with a verdict on who is winning.
2. **Political & Economic Risk** — *mandatory, never skipped.* Tariff exposure, active litigation, regulatory binaries, international revenue concentration, interest rate sensitivity. Material risks get a probability / impact / mitigation table.
3. **Dividend Profile** — yield, payout ratio, 5-yr DGR, safety verdict. For pipelines and infrastructure (ENB), use **DCF payout ratio, never GAAP** — GAAP is misleading for these companies.
4. **Last 3 Months** — price structure quantified, beat/miss % vs consensus, dated catalysts, volume Z-score spikes, next earnings date.
5. **Traditional Sentiment** — consensus rating, analyst count, average 12-mo target and % upside, two quantified bull cases, two quantified bear cases, insider Form 4 activity.
6. **Technical Frameworks** — the five lenses below.

---

## Step 3 — The Five Technical Lenses (TCREI)

They are **not equal-weighted**. Each answers a different question.

### A · Wyckoff — *where in the cycle?*
Is smart money absorbing supply or unloading it? Accumulation Phase C/D is the buy zone. Distribution means don't buy, no matter how strong the fundamentals.

> *Example:* The April 2026 META report — exceptional fundamentals, but Phase B/C distribution confirmed. Verdict was scale-in DCA only, not full size.

### B · RS vs SPY — *a veto, not a score*
Binary pass/fail. Declining RS disqualifies a tactical entry regardless of everything else.

### C · Pattern + Volume — *confirmation*
Price alone never confirms a breakout. Requires **40%+ above the 50-day average volume** or it is logged as an unconfirmed attempt.

### D · Fibonacci — *the arithmetic*
Where the actual numbers come from:
- **0.618 retracement** → entry zone
- **0.786 retracement** → stop-loss
- **1.272 / 1.618 extension** → target

Those three numbers produce the R:R ratio that feeds the hard gate in Step 1. This lens does the most work.

### E · Elliott Wave — *positioning*
- Wave 3 → ride it
- Wave 5 → trim
- Wave 2 / 4 → cautious scale

Lowest-confidence framework. Always labeled with a confidence level so it never carries a decision alone.

---

## Step 4 — Verdict & Ranking

Signals combine through a **decision table**, not an average:

| Signal combination | Verdict |
|---|---|
| Wyckoff C/D + RS pass + Wave 3 + volume confirmed | **STRONG BUY** |
| Accumulation + RS pass + Wave 2 corrective | **BUY — scale in cautiously** |
| RS fail (underperforming SPY) | **DISQUALIFIED** (tactical) |
| Wave 5 + distribution phase | **TRIM or AVOID** |
| R:R below 2:1 | **No entry, regardless of other signals** |
| Earnings within 30 days + IV elevated | Flag: options expensive, IV crush risk |

Then:
- **Conviction score** out of 10
- **Portfolio impact check** — position size after the buy, bucket utilization vs. target, concentration flags, correlation with existing holdings
- **Thesis invalidation** — a specific price level *plus* volume condition that means the trade was wrong

### The score never overrides a gate

> *Example — DOCN, April 2026.* Scored 6/10 with a legitimate AI-acceleration story and top-decile relative strength. Verdict was still "wait for the $84–87 pullback" — the breakout lacked volume confirmation and the stock traded above median analyst target ($76.50).

---

## Step 5 — Self-Eval

Every full report closes with a Pass/Fail on data completeness and a one-line iteration prompt.

> *Example — DOCN self-evaluated **FAIL*** because live IV rank and historical earnings gap data were unavailable. The gap gets stated, not papered over. Resolution path: Barchart.com for IV rank, MarketChameleon.com for historical earnings moves.

---

## Analysis Modes

| Mode | Use case | Output |
|---|---|---|
| **A** | Single ticker, deep dive | Full TCREI report + PDF |
| **B** | Existing position check | Status / stop buffer / HOLD-ADD-TRIM-EXIT |
| **C** | 3–5 ticker watchlist scan | Condensed scorecards + ranked priority order |

---

## Standing Principles

- **Volume confirms breakouts — price alone does not.** The rule holds regardless of narrative catalysts.
- **Sector concentration is a hard cap, not a guideline.** Checked before any new add is evaluated.
- **Earnings windows are no-add zones.** Enforced even when the thesis is strong.
- **R:R minimum 2:1 is non-negotiable.** High-conviction names get rejected above their ideal zone.
- **Bucket allocation drives deployment sequencing.** Cash goes to the most underweight bucket first, not the most exciting stock.
- **Deepen over diversify.** When buckets are over-allocated, add to existing high-conviction names at better entries rather than opening new positions.
- **Wide stops for income holds; tight stops for tactical.** Don't apply trading stops to core positions.
- **Screenshot data takes precedence** over typed figures when conflicts arise.

---

*For informational purposes only. Not financial advice. Always verify live data before entry.*
