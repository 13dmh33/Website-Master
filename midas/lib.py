"""Shared helpers for screener.py, analyze.py, and tcrei.py."""


def num(v):
    """Coerce a possibly-stringified numeric (from JSON round-trip) to float, or None."""
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def composite_score(row):
    """Step 5 scoring rubric, shared so analyze.py and tcrei.py never drift apart."""
    s = 0.0
    rs3 = num(row.get("RS_3mo"))
    rs3 = rs3 if rs3 is not None else -999
    if rs3 > 10:
        s += 3
    elif rs3 > 5:
        s += 2
    elif rs3 >= 0:
        s += 1

    fz = row.get("Fib_Zone")
    s += 2 if fz == "BELOW_50" else (1.5 if fz == "IN_ZONE" else 0)

    vr = num(row.get("Vol_Ratio")) or 0
    cp = num(row.get("Close_Position")) or 0
    if vr > 140 and cp > 0.5:
        s += 2

    ts = row.get("Trend_State")
    s += 1 if ts == "UPTREND" else (0.5 if ts == "BASING" else 0)

    rg = num(row.get("Rev_Growth_YoY"))
    md = num(row.get("Margin_Delta"))
    if rg is not None and rg > 15 and md is not None and md >= 0:
        s += 1

    ins = num(row.get("Insider_Net_3mo"))
    if ins is not None:
        s += 1 if ins > 0 else (0.5 if ins == 0 else 0)
    else:
        s += 0.5  # neutral default — no fabricated signal

    return round(s, 2)
