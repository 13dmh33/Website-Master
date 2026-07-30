#!/usr/bin/env python3
"""NYSE/NASDAQ DCA candidate screener — zero-cost (yfinance only, no paid API)."""
import json
import math
import sys
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

# ---------------- SESSION INPUTS ----------------
# Was hardcoded to a literal date string — every run (including the scheduled
# GitHub Actions one) would always label itself "2026-07-28" regardless of the
# actual date, silently overwriting the same report files forever. Fixed to
# compute the real run date.
RUN_DATE = datetime.now().strftime("%Y-%m-%d")
CASH_AVAILABLE = 148
MIN_POSITION = 40
MAX_POSITION = 100
PORTFOLIO_VALUE = 0
CURRENT_HOLDINGS = {"META": 0, "LLY": 0, "ZETA": 0, "PLTR": 0, "SMH": 0, "NOW": 0}

# Hand-curated candidate universe. NOTE: live ETF-holdings / index-constituent
# scraping (SMH, ITA, URA, XBI, IHI) requires either a paid data provider or
# scraping provider holdings pages beyond this script's zero-cost scope this
# run -- substituting a manually curated candidate list per sector instead,
# disclosed here rather than silently faked.
UNIVERSE = {
    "AI infrastructure": ["INTC", "AMD", "MU", "ON", "MRVL", "SMCI", "ANET", "CIEN",
                           "DELL", "HPE", "VRT", "CRDO", "LITE", "COHR", "GLW", "JBL",
                           "FN", "MPWR", "QCOM", "WOLF"],
    "Defense / aerospace": ["RTX", "LHX", "HII", "TXT", "KTOS", "AVAV", "BWXT",
                             "LDOS", "SAIC", "MRCY"],
    "Nuclear / clean energy": ["CCJ", "UEC", "DNN", "NXE", "SMR", "OKLO", "LEU",
                                "UUUU", "ENPH", "RUN", "ARRY", "FLNC"],
    "Healthcare / biotech": ["PFE", "VTRS", "TEVA", "GILD", "MRNA", "RXRX", "EXAS",
                              "NTRA", "TDOC", "HIMS", "MDT", "BSX", "ZBH", "BAX",
                              "CRSP", "VKTX", "ALNY", "NBIX", "PODD"],
}

TICKER_SECTOR = {t: s for s, ts in UNIVERSE.items() for t in ts}
ALL_TICKERS = sorted(set(t for ts in UNIVERSE.values() for t in ts) - set(CURRENT_HOLDINGS))

print(f"Universe before filtering: {len(ALL_TICKERS)} tickers", file=sys.stderr)

run_dt = datetime.strptime(RUN_DATE, "%Y-%m-%d")


def safe_get(info, key, default=None):
    v = info.get(key, default)
    return v if v is not None else default


results = []

# Pull SPY once for RS calc
spy_hist = yf.Ticker("SPY").history(period="2y", auto_adjust=True)
spy_hist.index = spy_hist.index.tz_localize(None)

for i, tk in enumerate(ALL_TICKERS):
    row = {"Ticker": tk, "data_gaps": [], "rejected_for": None}
    try:
        t = yf.Ticker(tk)
        info = t.info
        hist = t.history(period="2y", auto_adjust=True)
        if hist.empty or len(hist) < 60:
            row["rejected_for"] = "no_price_history"
            results.append(row)
            continue
        hist.index = hist.index.tz_localize(None)

        price = safe_get(info, "currentPrice") or hist["Close"].iloc[-1]
        prev_close = safe_get(info, "previousClose")
        avg_vol = safe_get(info, "averageVolume")
        adv_dollar = (avg_vol or 0) * price

        # --- exchange / liquidity / ADR / affordability filters (Step 1) ---
        exch = safe_get(info, "exchange", "")
        quote_type = safe_get(info, "quoteType", "")
        if quote_type not in ("EQUITY",):
            row["rejected_for"] = f"not_common_equity ({quote_type})"
            results.append(row)
            continue
        if adv_dollar < 5_000_000:
            row["rejected_for"] = "liquidity_floor"
            results.append(row)
            continue
        if price > MAX_POSITION:
            row["rejected_for"] = "price_above_max_position"
            results.append(row)
            continue

        high52 = safe_get(info, "fiftyTwoWeekHigh")
        low52 = safe_get(info, "fiftyTwoWeekLow")
        sma200 = safe_get(info, "twoHundredDayAverage")
        sma50 = safe_get(info, "fiftyDayAverage")

        closes = hist["Close"]
        highs = hist["High"]
        lows = hist["Low"]
        vols = hist["Volume"]

        today = hist.iloc[-1]
        vol_ratio = (today["Volume"] / (vols.tail(50).mean())) * 100 if len(vols) >= 50 else None
        pct_vs_200dma = ((price - sma200) / sma200 * 100) if sma200 else None
        drawdown_pct = ((high52 - price) / high52 * 100) if high52 else None
        close_position = ((today["Close"] - today["Low"]) / (today["High"] - today["Low"])
                           if today["High"] != today["Low"] else 0.5)

        # RS vs SPY
        def pct_change(series, n):
            if len(series) <= n:
                return None
            return (series.iloc[-1] / series.iloc[-1 - n] - 1) * 100

        spy_closes = spy_hist["Close"].reindex(closes.index, method="ffill")
        rs_3mo = None
        rs_6mo = None
        rs_slope = None
        if len(closes) > 63 and len(spy_closes.dropna()) > 63:
            t_63 = pct_change(closes, 63)
            s_63 = pct_change(spy_closes, 63)
            rs_3mo = (t_63 - s_63) if (t_63 is not None and s_63 is not None) else None
        if len(closes) > 126 and len(spy_closes.dropna()) > 126:
            t_126 = pct_change(closes, 126)
            s_126 = pct_change(spy_closes, 126)
            rs_6mo = (t_126 - s_126) if (t_126 is not None and s_126 is not None) else None
        if len(closes) > 63 and len(spy_closes.dropna()) > 63:
            ratio = (closes / spy_closes).tail(63).dropna()
            if len(ratio) > 10:
                x = np.arange(len(ratio))
                slope = np.polyfit(x, ratio.values, 1)[0]
                rs_slope = slope

        trailing_252 = hist.tail(252)
        swing_high = trailing_252["High"].max()
        swing_low = trailing_252["Low"].min()

        fib_range = swing_high - swing_low
        fib_levels = {lvl: swing_high - fib_range * lvl for lvl in [0.236, 0.382, 0.5, 0.618, 0.786]}
        fib_ext = swing_high + fib_range * 0.618

        if price < fib_levels[0.5]:
            fib_zone = "BELOW_50"
        elif price <= fib_levels[0.618]:
            fib_zone = "IN_ZONE"
        else:
            fib_zone = "EXTENDED"

        next_resistance = high52
        resistance_source = "52wk_high"
        rr_ratio = None
        if fib_levels[0.786] and price != fib_levels[0.786]:
            denom = price - fib_levels[0.786]
            if denom != 0 and next_resistance:
                rr_ratio = (next_resistance - price) / denom

        # --- earnings ---
        days_to_earnings = None
        try:
            edates = t.get_earnings_dates(limit=8)
            future = [d for d in edates.index.tz_localize(None) if d > run_dt] if edates is not None else []
            if future:
                days_to_earnings = (min(future) - run_dt).days
        except Exception:
            row["data_gaps"].append("earnings_date")

        # --- fundamentals ---
        pe_trailing = safe_get(info, "trailingPE")
        pe_forward = safe_get(info, "forwardPE")
        ps_ratio = safe_get(info, "priceToSalesTrailing12Months")
        market_cap = safe_get(info, "marketCap")
        div_yield = safe_get(info, "dividendYield", 0.0) or 0.0  # yfinance returns this already in percent units
        payout_ratio = safe_get(info, "payoutRatio")
        payout_pct = (payout_ratio * 100) if payout_ratio is not None else None
        debt_to_equity = safe_get(info, "debtToEquity")
        debt_to_equity = (debt_to_equity / 100) if debt_to_equity is not None else None

        rev_growth_yoy = None
        margin_delta = None
        try:
            qf = t.quarterly_financials
            if qf is not None and "Total Revenue" in qf.index and qf.shape[1] >= 5:
                rev_latest = qf.loc["Total Revenue"].iloc[0]
                rev_yoy = qf.loc["Total Revenue"].iloc[4]
                if rev_yoy:
                    rev_growth_yoy = (rev_latest / rev_yoy - 1) * 100
                if "Gross Profit" in qf.index:
                    gm_latest = qf.loc["Gross Profit"].iloc[0] / rev_latest * 100
                    gm_yoy = qf.loc["Gross Profit"].iloc[4] / rev_yoy * 100
                    margin_delta = gm_latest - gm_yoy
        except Exception:
            row["data_gaps"].append("quarterly_financials")

        insider_net = None
        try:
            it = t.insider_transactions
            if it is not None and not it.empty and "Value" in it.columns:
                insider_net = float(it["Value"].fillna(0).sum())
        except Exception:
            row["data_gaps"].append("insider_transactions")

        short_pct_float = safe_get(info, "shortPercentOfFloat")
        analyst_rating = safe_get(info, "recommendationKey")
        analyst_count = safe_get(info, "numberOfAnalystOpinions")
        analyst_target = safe_get(info, "targetMeanPrice")
        analyst_upside = ((analyst_target - price) / price * 100) if analyst_target else None

        sector = safe_get(info, "sector")
        sub_industry = safe_get(info, "industry")

        if pct_vs_200dma is not None and sma50 and sma200:
            trend_state = "UPTREND" if (price > sma200 and sma50 > sma200) else (
                "DOWNTREND" if (price < sma200 and sma50 < sma200) else "BASING")
        else:
            trend_state = None

        # Tier-1 completeness check
        tier1_fields = [price, high52, low52, today["Volume"], avg_vol, sma200]
        tier1_nulls = sum(1 for v in tier1_fields if v is None)
        if tier1_nulls > 3:
            row["rejected_for"] = "data_quality_tier1"
            results.append(row)
            continue

        row.update(dict(
            Company=safe_get(info, "shortName", tk),
            Price=round(price, 2),
            High52=high52, Low52=low52,
            Drawdown_Pct=round(drawdown_pct, 2) if drawdown_pct is not None else None,
            Vol_Ratio=round(vol_ratio, 1) if vol_ratio is not None else None,
            Pct_vs_200DMA=round(pct_vs_200dma, 2) if pct_vs_200dma is not None else None,
            RS_3mo=round(rs_3mo, 2) if rs_3mo is not None else None,
            RS_6mo=round(rs_6mo, 2) if rs_6mo is not None else None,
            RS_Slope=round(rs_slope, 5) if rs_slope is not None else None,
            Close_Position=round(close_position, 3),
            PE_Trailing=pe_trailing, PE_Forward=pe_forward, PS_Ratio=ps_ratio,
            Fib_50=round(fib_levels[0.5], 2), Fib_618=round(fib_levels[0.618], 2),
            Fib_786=round(fib_levels[0.786], 2), Fib_Ext_1618=round(fib_ext, 2),
            Fib_Zone=fib_zone, RR_Ratio=round(rr_ratio, 2) if rr_ratio is not None else None,
            Resistance_Source=resistance_source,
            Days_To_Earnings=days_to_earnings,
            Sector=sector, Sub_Industry=sub_industry,
            Rev_Growth_YoY=round(rev_growth_yoy, 2) if rev_growth_yoy is not None else None,
            Margin_Delta=round(margin_delta, 2) if margin_delta is not None else None,
            Debt_To_Equity=round(debt_to_equity, 2) if debt_to_equity is not None else None,
            Div_Yield=round(div_yield, 2), Payout_Ratio=round(payout_pct, 1) if payout_pct is not None else None,
            Insider_Net_3mo=insider_net,
            Short_Pct_Float=round(short_pct_float * 100, 2) if short_pct_float is not None else None,
            Analyst_Rating=analyst_rating, Analyst_Count=analyst_count,
            Analyst_Target=analyst_target,
            Analyst_Upside=round(analyst_upside, 2) if analyst_upside is not None else None,
            Trend_State=trend_state,
            Market_Cap=market_cap,
            ADV_Dollar=round(adv_dollar, 0),
        ))
        results.append(row)
        print(f"  [{i+1}/{len(ALL_TICKERS)}] {tk} OK", file=sys.stderr)
    except Exception as e:
        row["rejected_for"] = f"fetch_error: {e}"
        results.append(row)
        print(f"  [{i+1}/{len(ALL_TICKERS)}] {tk} ERROR: {e}", file=sys.stderr)

with open("/Users/davidhettinger/Website-Master/midas/reports/raw_results.json", "w") as f:
    json.dump(results, f, default=str, indent=2)

print(f"\nDone. {len(results)} tickers processed.", file=sys.stderr)
