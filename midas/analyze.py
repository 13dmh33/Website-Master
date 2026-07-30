#!/usr/bin/env python3
"""Midas — Step 4 (hard filters) / Step 5 (ranking) / Step 6 (output)."""
import csv
import json
from datetime import datetime

from lib import num, composite_score

# Was hardcoded — see screener.py's identical fix note. Must match
# screener.py's RUN_DATE since that's what named raw_results.json's sibling
# report files this reads/writes.
RUN_DATE = datetime.now().strftime("%Y-%m-%d")
CASH_AVAILABLE = 148
MIN_POSITION = 40
MAX_POSITION = 100

with open("reports/raw_results.json") as f:
    data = json.load(f)


def is_dividend_name(row):
    return (num(row.get("Div_Yield")) or 0) > 1.5


for row in data:
    if row.get("rejected_for"):
        continue  # already dropped in Step 1

    reasons = []
    dte = num(row.get("Days_To_Earnings"))
    if dte is not None and dte < 30:
        reasons.append(f"earnings_blackout ({dte:.0f}d to earnings)")

    rs3 = num(row.get("RS_3mo"))
    slope = num(row.get("RS_Slope"))
    if rs3 is None or slope is None:
        row["data_gaps"].append("rs_metrics")
    elif rs3 < 0 or slope <= 0:
        reasons.append(f"relative_strength (rs_3mo={rs3}, slope={slope})")

    if row.get("Fib_Zone") == "EXTENDED" and (num(row.get("RR_Ratio")) or 0) < 2.0:
        reasons.append("risk_reward")

    div_name = is_dividend_name(row)
    dte_thresh = 2.0 if div_name else 1.5
    de = num(row.get("Debt_To_Equity"))
    if de is not None and de > dte_thresh:
        reasons.append(f"debt (D/E={de} > {dte_thresh})")

    dy = num(row.get("Div_Yield")) or 0
    if dy > 8:
        reasons.append(f"yield_trap ({dy}%)")

    pr = num(row.get("Payout_Ratio"))
    pr_thresh = 85 if div_name else 75
    if pr is not None and pr > pr_thresh:
        reasons.append(f"payout ({pr}% > {pr_thresh}%)")

    rg = num(row.get("Rev_Growth_YoY"))
    if rg is None:
        row["data_gaps"].append("rev_growth_yoy")
    elif rg < 0:
        reasons.append(f"revenue_decline ({rg}%)")

    if len(row.get("data_gaps", [])) > 3:
        reasons.append("data_quality")

    if reasons:
        row["rejected_for"] = "; ".join(reasons)

    row["earnings_window_active"] = bool(dte is not None and dte < 30)

    # concentration checks skipped, portfolio_value = 0
    row["concentration_check"] = "SKIPPED — portfolio_value not provided"

# --- Step 5: score survivors ---
survivors = [r for r in data if not r.get("rejected_for") and "Price" in r]

for row in survivors:
    row["Score"] = composite_score(row)
    score = row["Score"]
    fz = row.get("Fib_Zone")

    if score >= 7 and fz in ("BELOW_50", "IN_ZONE"):
        row["Verdict"] = "BEST DCA ENTRY"
    elif score >= 7 and fz == "EXTENDED":
        row["Verdict"] = "WATCHLIST - TOO EXTENDED"
    elif score >= 7:
        row["Verdict"] = "WATCHLIST - VALUATION"
    else:
        row["Verdict"] = "SKIP"

survivors.sort(key=lambda r: r["Score"], reverse=True)

# --- Step 6a: CSV ---
FIELDS = ["Ticker", "Company", "Price", "High52", "Low52", "Drawdown_Pct", "Vol_Ratio",
          "Pct_vs_200DMA", "RS_3mo", "RS_6mo", "RS_Slope", "Close_Position", "PE_Trailing",
          "PE_Forward", "PS_Ratio", "Fib_50", "Fib_618", "Fib_786", "Fib_Ext_1618",
          "Fib_Zone", "RR_Ratio", "Days_To_Earnings", "Sector", "Sub_Industry",
          "Rev_Growth_YoY", "Margin_Delta", "Debt_To_Equity", "Div_Yield", "Payout_Ratio",
          "Insider_Net_3mo", "Short_Pct_Float", "Analyst_Rating", "Analyst_Target",
          "Analyst_Upside", "Trend_State", "Score", "Verdict", "rejected_for", "data_gaps"]

with open(f"reports/screen_{RUN_DATE}.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
    w.writeheader()
    for row in sorted(data, key=lambda r: r.get("Score", -1), reverse=True):
        out = dict(row)
        out["data_gaps"] = ";".join(row.get("data_gaps", []))
        w.writerow(out)

with open(f"reports/screen_{RUN_DATE}.json", "w") as f:
    json.dump({
        "run_date": RUN_DATE,
        "source": "yfinance (Yahoo Finance), zero-cost",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "tickers": data,
    }, f, indent=2, default=str)

# --- Step 6c: chat summary ---
top5 = survivors[:5]
print(f"=== Midas screen — {RUN_DATE} (prices as of prior close, US/Eastern) ===\n")
for r in top5:
    price = num(r["Price"])
    rs3mo = num(r.get("RS_3mo"))
    print(f"{r['Ticker']} — {r['Company']} — ${price} — {r['Sector']}")
    print(f"├─ RS vs SPY (3mo): {rs3mo:+.1f}% — {'PASS' if rs3mo is not None and rs3mo>=0 else 'CHECK'}" if rs3mo is not None else "├─ RS vs SPY (3mo): unknown (data gap)")
    print(f"├─ Fib: 0.50 = ${r['Fib_50']} | 0.618 = ${r['Fib_618']} | zone = {r['Fib_Zone']}")
    upper = "upper" if (num(r.get("Close_Position")) or 0) > 0.5 else "lower"
    print(f"├─ Volume: {r.get('Vol_Ratio')}% of 50-day avg | closed {upper} half")
    pct200 = num(r.get("Pct_vs_200DMA"))
    print(f"├─ Trend: {r.get('Trend_State')} | {pct200:+.1f}% vs 200DMA" if pct200 is not None else f"├─ Trend: {r.get('Trend_State')}")
    dte = num(r.get("Days_To_Earnings"))
    print(f"├─ Earnings: {dte:.0f} days out" if dte is not None else "├─ Earnings: unknown (data gap)")
    rg = num(r.get("Rev_Growth_YoY"))
    de = r.get("Debt_To_Equity")
    print(f"├─ Fundamentals: rev {rg:+.1f}% YoY | margin {r.get('Margin_Delta')}pp | D/E {de}" if rg is not None else "├─ Fundamentals: incomplete (data gap)")
    shares = int(CASH_AVAILABLE // price)
    print(f"├─ Shares affordable at ${CASH_AVAILABLE}: {shares}")
    print(f"├─ Score: {r['Score']}/10")
    print(f"└─ Verdict: {r['Verdict']} — {r.get('rejected_for') or 'passed all hard filters'}\n")

print(f"CASH DEPLOYMENT — ${CASH_AVAILABLE} available")
remaining = CASH_AVAILABLE
picks = [r for r in top5 if r["Verdict"] == "BEST DCA ENTRY"]
i = 1
for r in picks:
    if remaining < MIN_POSITION:
        break
    alloc = min(MAX_POSITION, remaining)
    shares = int(alloc // r["Price"])
    if shares == 0:
        continue
    spend = shares * r["Price"]
    remaining -= spend
    print(f"{i}. {r['Ticker']} — ${spend:.2f} ({shares} shares) — score {r['Score']}/10, {r['Fib_Zone']}")
    i += 1
print(f"Unallocated: ${remaining:.2f}")
print("Concentration check: SKIPPED — portfolio_value not provided")
