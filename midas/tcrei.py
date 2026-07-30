#!/usr/bin/env python3
"""Midas — TCREI Mode C watchlist scan.

Second skill, separate from screener.py/analyze.py's DCA screen. Runs the same
day's raw_results.json through the TCREI hard-gate + ranking methodology
(tcrei-methodology.md) and produces a condensed scorecard for the top 5
by importance, from the FULL candidate pool (not just DCA-filter survivors).

Only the deterministic/quantifiable parts of the framework are automated:
R:R, RS veto, volume confirmation, earnings-window (when known), Fibonacci
levels, dividend safety, sentiment/insider numbers. Wyckoff phase, Elliott Wave,
industry-competitor verdicts, and political/economic risk are NOT computable
from this data source — each is explicitly flagged MANUAL REVIEW REQUIRED
rather than guessed, per the hard rule against fabricating a data point, and
per the framework's own Step 5 self-eval principle (state the gap, don't paper
over it).
"""
import json
from datetime import datetime

from lib import num, composite_score

RUN_DATE = "2026-07-28"
BUCKET = "tactical"  # per session inputs — all 5 lenses required, tight stop
TOP_N = 5

with open("reports/raw_results.json") as f:
    data = json.load(f)

pool = [r for r in data if "Price" in r and r.get("Price") is not None]
for r in pool:
    r["_score"] = composite_score(r)
pool.sort(key=lambda r: r["_score"], reverse=True)
top = pool[:TOP_N]


def gate(name, result, detail):
    return {"gate": name, "result": result, "detail": detail}


def evaluate_gates(r):
    gates = []

    rr = num(r.get("RR_Ratio"))
    if rr is None:
        gates.append(gate("R:R >= 2:1", "UNKNOWN", "no RR_Ratio computed"))
    else:
        gates.append(gate("R:R >= 2:1", "PASS" if rr >= 2.0 else "FAIL", f"{rr}"))

    rs3 = num(r.get("RS_3mo"))
    slope = num(r.get("RS_Slope"))
    if rs3 is None or slope is None:
        gates.append(gate("RS vs SPY", "UNKNOWN", "rs metrics missing"))
    else:
        ok = rs3 >= 0 and slope > 0
        gates.append(gate("RS vs SPY", "PASS" if ok else "FAIL", f"rs_3mo={rs3}, slope={slope}"))

    dte = num(r.get("Days_To_Earnings"))
    if dte is None:
        gates.append(gate("Earnings window (<30d)", "UNKNOWN", "no confirmed next earnings date from source"))
    else:
        gates.append(gate("Earnings window (<30d)", "FAIL" if dte < 30 else "PASS", f"{dte:.0f}d out"))

    # 52-wk high / CEG rule: heuristic proxy only — no multi-day retest data available.
    dd = num(r.get("Drawdown_Pct"))
    if dd is None:
        gates.append(gate("52wk-high / CEG rule", "UNKNOWN", "no drawdown data"))
    elif dd < 8:
        gates.append(gate("52wk-high / CEG rule", "FAIL", f"only {dd}% off 52wk high, no confirmed retest (heuristic)"))
    else:
        gates.append(gate("52wk-high / CEG rule", "PASS", f"{dd}% off 52wk high"))

    vr = num(r.get("Vol_Ratio"))
    if vr is None:
        gates.append(gate("Volume confirmation (>=140%)", "UNKNOWN", "no volume ratio"))
    else:
        gates.append(gate("Volume confirmation (>=140%)", "PASS" if vr >= 140 else "FAIL", f"{vr}% of 50d avg"))

    gates.append(gate("Sector ceiling (ad-tech)", "SKIPPED", "not an ad-tech name" if r.get("Sub_Industry") not in ("Advertising", "Ad-tech") else "requires portfolio_value"))
    gates.append(gate("Bucket allocation", "SKIPPED", "portfolio_value not provided"))

    return gates


def dividend_safety(r):
    dy = num(r.get("Div_Yield")) or 0
    payout = num(r.get("Payout_Ratio"))
    if dy == 0:
        return "N/A — no dividend"
    if payout is None:
        return "UNKNOWN — payout ratio unavailable"
    if payout > 100:
        return f"UNSAFE — GAAP payout {payout}% exceeds earnings"
    if payout > 75:
        return f"AT RISK — GAAP payout {payout}%"
    return f"SAFE on GAAP payout ({payout}%)"


def bull_bear(r):
    bulls, bears = [], []
    rs3 = num(r.get("RS_3mo"))
    if rs3 is not None and rs3 > 0:
        bulls.append(f"RS vs SPY +{rs3:.1f}% (3mo)")
    rg = num(r.get("Rev_Growth_YoY"))
    if rg is not None and rg > 0:
        bulls.append(f"revenue +{rg:.1f}% YoY")
    upside = num(r.get("Analyst_Upside"))
    if upside is not None and upside > 0:
        bulls.append(f"analyst target implies +{upside:.1f}% upside")

    rr = num(r.get("RR_Ratio"))
    if rr is not None and rr < 2.0:
        bears.append(f"R:R only {rr} — fails the 2:1 gate")
    md = num(r.get("Margin_Delta"))
    if md is not None and md < 0:
        bears.append(f"gross margin contracted {md}pp YoY")
    if rg is not None and rg < 0:
        bears.append(f"revenue declined {rg:.1f}% YoY")
    if upside is not None and upside < 0:
        bears.append(f"price is above the average analyst target ({upside:.1f}%)")
    vr = num(r.get("Vol_Ratio"))
    if vr is not None and vr < 140:
        bears.append(f"no volume confirmation ({vr}% of 50d avg, needs 140%+)")

    return bulls[:2], bears[:2]


def verdict(gates):
    fails = [g for g in gates if g["result"] == "FAIL"]
    unknowns = [g for g in gates if g["result"] == "UNKNOWN"]
    if fails:
        names = ", ".join(g["gate"] for g in fails)
        return f"NO ENTRY — failed: {names}"
    if unknowns:
        names = ", ".join(g["gate"] for g in unknowns)
        return f"CONDITIONAL — quantifiable gates pass, pending: {names}, plus manual Wyckoff/Elliott Wave review"
    return "QUANTIFIABLE GATES PASS — needs manual Wyckoff/Elliott Wave confirmation before any BUY verdict"


report = {
    "run_date": RUN_DATE,
    "bucket": BUCKET,
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "methodology": "TCREI Mode C — see tcrei-methodology.md",
    "gaps_this_run": [
        "Industry trend: named-competitor win/lose verdict — not sourced",
        "Political & economic risk — not independently verified (mandatory layer, flagged not cleared)",
        "13F institutional flow — not sourced",
        "Wyckoff phase — not computed (needs volume-by-price/time structure, not in this data source)",
        "Elliott Wave count — not computed (subjective, framework says never let it carry a decision alone anyway)",
        "IV rank, historical earnings-surprise series — not sourced",
    ],
    "tickers": [],
}

for r in top:
    gates = evaluate_gates(r)
    bulls, bears = bull_bear(r)
    entry = {
        "Ticker": r["Ticker"],
        "Company": r.get("Company"),
        "Price": num(r.get("Price")),
        "Sector": r.get("Sector"),
        "Sub_Industry": r.get("Sub_Industry"),
        "Score": r["_score"],
        "Fib_Zone": r.get("Fib_Zone"),
        "Fib_618_entry": r.get("Fib_618"),
        "Fib_786_stop": r.get("Fib_786"),
        "Fib_Ext_1618_target": r.get("Fib_Ext_1618"),
        "hard_gates": gates,
        "dividend_safety": dividend_safety(r),
        "bull_case": bulls,
        "bear_case": bears,
        "wyckoff_phase": "MANUAL REVIEW REQUIRED — not sourced by this pipeline",
        "elliott_wave": "MANUAL REVIEW REQUIRED — not sourced by this pipeline (low-confidence lens even when done manually)",
        "industry_trend_competitors": "MANUAL REVIEW REQUIRED — not sourced by this pipeline",
        "political_economic_risk": "MANUAL REVIEW REQUIRED — mandatory layer, not independently verified this run",
        "verdict": verdict(gates),
    }
    report["tickers"].append(entry)

with open(f"reports/tcrei_{RUN_DATE}.json", "w") as f:
    json.dump(report, f, indent=2, default=str)

# --- chat / markdown-style summary ---
lines = [f"=== Midas TCREI Mode C scan — {RUN_DATE} — bucket: {BUCKET} ===\n"]
for e in report["tickers"]:
    lines.append(f"{e['Ticker']} — {e['Company']} — ${e['Price']} — {e['Sector']} / {e['Sub_Industry']}")
    for g in e["hard_gates"]:
        if g["result"] in ("FAIL", "UNKNOWN"):
            lines.append(f"  [{g['result']}] {g['gate']} — {g['detail']}")
    lines.append(f"  Fib: entry ${e['Fib_618_entry']} | stop ${e['Fib_786_stop']} | target ${e['Fib_Ext_1618_target']} | zone {e['Fib_Zone']}")
    lines.append(f"  Dividend safety: {e['dividend_safety']}")
    if e["bull_case"]:
        lines.append(f"  Bull: {'; '.join(e['bull_case'])}")
    if e["bear_case"]:
        lines.append(f"  Bear: {'; '.join(e['bear_case'])}")
    lines.append(f"  Wyckoff / Elliott Wave / competitors / political risk: MANUAL REVIEW REQUIRED (not sourced)")
    lines.append(f"  Score: {e['Score']}/10")
    lines.append(f"  Verdict: {e['verdict']}")
    lines.append("")

lines.append("Self-eval: FAIL (by design, every run) — gaps: " + "; ".join(report["gaps_this_run"]))

summary_text = "\n".join(lines)
print(summary_text)

with open(f"reports/tcrei_{RUN_DATE}_summary.txt", "w") as f:
    f.write(summary_text + "\n")
