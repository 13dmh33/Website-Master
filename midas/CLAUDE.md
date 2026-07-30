# Midas — personal DCA stock screener

**Not a Trevo Advisors system.** This is Dave's personal tool, kept in this repo at his
request ("keep in same repo for now") but otherwise unrelated to Trevo/Molly/Milly/Miley/
Reeve/Strategy/Nora/Merlin. Named to match this repo's one-word-agent convention
(Molly, Milly, Miley, Merlin, Missy) — Midas for money/stocks.

## What it does

Two skills, sharing the same daily data pull (`screener.py`'s `reports/raw_results.json`):

1. **DCA screen** (`screener.py` + `analyze.py`) — screens a candidate universe of
   NYSE/NASDAQ common stocks for dollar-cost-average entry candidates: pulls
   price/fundamental data, computes technical metrics (RS vs SPY, Fibonacci retracement
   zone, trend state, volume confirmation), applies hard filters, ranks survivors.
   Outputs a CSV, a JSON, and a chat-ready top-5 summary + cash deployment plan.
2. **TCREI Mode C watchlist scan** (`tcrei.py`) — a second, separate methodology
   (`tcrei-methodology.md`) applied to the **top 5 of the full candidate pool by
   composite score**, not just the DCA-filter survivors. Automates the deterministic
   hard gates (R:R, RS veto, volume confirmation, earnings window when known, a
   heuristic 52-wk-high/CEG-rule proxy) and the quantifiable layers (dividend safety,
   templated bull/bear cases from real pulled numbers). **Does not compute** Wyckoff
   phase, Elliott Wave, industry-competitor verdicts, or political/economic risk — those
   are qualitative judgment calls this zero-cost pipeline has no data source for, and
   each is explicitly labeled `MANUAL REVIEW REQUIRED` rather than guessed. Every run
   ends with an intentional Step-5 self-eval `FAIL`, listing exactly what's missing —
   per the methodology's own "state the gap, don't paper over it" rule.

**Review-only.** Nothing here places a trade. Output is a screening artifact, not
investment advice.

## Shared code

`lib.py` holds `composite_score()` (the Step-5 scoring rubric) and `num()` (safe numeric
coercion — raw JSON round-tripping can turn a numpy-derived value into a string; `num()`
guards every comparison against that). Both `analyze.py` and `tcrei.py` import from here
so the two skills can never silently drift apart on how a candidate is scored. Audited
2026-07-29: found and fixed a real bug at the source — `screener.py`'s insider-transaction
sum returned a numpy `int64`, which isn't natively JSON-serializable, so it silently
round-tripped through `raw_results.json` as a *string*; any later numeric comparison
against it would raise `TypeError`. Fixed by casting to `float()` before the dict is
built, and hardened both `analyze.py` and `tcrei.py` to run every field through `num()`
regardless, so the same class of bug can't recur even if a future field has the same issue.

## Data source — zero cost

Uses `yfinance` (free, unofficial Yahoo Finance wrapper) exclusively — no paid API key
(Alpha Vantage / FMP / Polygon / Tiingo were all considered per the original spec but
skipped to keep this at $0 running cost). If a paid data source is ever needed to close
a real gap, ask Dave before signing up for anything.

## Known limitation — universe construction

The original spec calls for building the candidate universe live from index constituents
and sector-ETF holdings (SMH, ITA, URA, XBI, IHI). That requires either a paid data
provider or scraping ETF-provider holdings pages, which was out of scope for this build
at $0. `screener.py`'s `UNIVERSE` dict is a **hand-curated candidate list per sector**
instead — disclosed here rather than silently substituted. Revisit if Dave wants broader
or more current coverage (e.g., pulling holdings CSVs directly from provider sites is
free and could replace this without a paid API).

## Running it

```bash
cd midas
python3 screener.py   # Steps 1-3: pull raw data, compute derived metrics -> reports/raw_results.json
python3 analyze.py    # Steps 4-6: DCA hard filters, ranking, CSV/JSON/chat output
python3 tcrei.py       # TCREI Mode C: separate hard-gate scan on the top-5-by-score, CSV/JSON/chat output
```

`tcrei.py` reads `screener.py`'s output, so `screener.py` must run first (same as
`analyze.py`). Edit the `SESSION INPUTS` / bucket constants at the top of each file
before a run (cash available, position sizing, current holdings, portfolio value for
concentration checks, TCREI bucket).

## Schedule

`.github/workflows/midas-daily.yml` — 21:00 UTC, Monday-Friday only, ~1 hour after US
market close (4:00pm ET) while EDT is in effect; drifts to right-at-close during EST
since a static cron can't track DST — noted in the workflow file, revisit if it matters.
Runs `screener.py` -> `analyze.py` -> `tcrei.py` in sequence. Report files are uploaded as
workflow artifacts (90-day retention) rather than committed — see `.gitignore`
(`midas/reports/*.csv`, `*.json`, `*.md`, `*.txt`).

## File structure

```
midas/
  CLAUDE.md
  tcrei-methodology.md   # reference spec for tcrei.py — Dave's TCREI framework doc
  lib.py                 # shared composite_score() + num(), used by analyze.py and tcrei.py
  screener.py            # Steps 1-3: universe, raw data pull, derived metrics -> raw_results.json
  analyze.py             # Steps 4-6: DCA hard filters, scoring/ranking, CSV/JSON/chat output
  tcrei.py               # TCREI Mode C: hard gates + condensed scorecards on top-5-by-score
  reports/                # gitignored output (screen_*, tcrei_*, raw_results.json)
```
