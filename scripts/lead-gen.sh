#!/usr/bin/env bash
# lead-gen.sh — one-command has-website EMAIL lead pipeline.
#
# The flow unlocked 2026-07-26: Scout (has-website) → contact-scraper (--deep) →
# Diagnoser → Checker, ending with a batch of approved, CAN-SPAM-compliant email
# leads ready for `pitcher --channel email`. Run this on the Mac — Scout
# (Outscraper) and contact-scraper (fetches lead sites) need real network.
#
# Usage:
#   bash scripts/lead-gen.sh "Dallas, TX" plumber            # default budget 0.25
#   bash scripts/lead-gen.sh "Houston, TX" electrician 0.50  # custom Outscraper cap
#
# Trades: plumber | electrician | handyman | roofer   (never hvac — excluded)
#
# Safety: refuses to run if another pipeline process is live, and backs up
# state.json + config/cost-log.json before touching anything.

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

CITY="${1:-}"
TRADE="${2:-}"
BUDGET="${3:-0.25}"

if [ -z "$CITY" ] || [ -z "$TRADE" ]; then
  echo "Usage: bash scripts/lead-gen.sh \"City, ST\" <trade> [budget]"
  echo "  e.g. bash scripts/lead-gen.sh \"Dallas, TX\" plumber 0.25"
  exit 1
fi
if [ "$(printf '%s' "$TRADE" | tr '[:upper:]' '[:lower:]')" = "hvac" ]; then
  echo "ERROR: HVAC is excluded (conflict of interest). Pick plumber/electrician/handyman/roofer."
  exit 1
fi
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found (needs OUTSCRAPER_API_KEY, ANTHROPIC_API_KEY)."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Has-website EMAIL lead-gen — $TRADE / $CITY"
echo "╚══════════════════════════════════════════════════╝"

# ── STEP 0: safety ───────────────────────────────────────────────────────────
echo ""
echo "[0/4] Preflight…"
if ps aux | grep -E 'node (scripts/(pitcher|drip|scout|checker|diagnoser|contact-scraper)|agents/)' | grep -v grep >/dev/null; then
  echo "  ✗ Another pipeline process is running. Wait for it to finish, then re-run."
  exit 1
fi
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BK="logs/state-backups"
mkdir -p "$BK"
cp state.json "$BK/state-$TS.json"
cp config/cost-log.json "$BK/cost-log-$TS.json"
echo "  ✓ No pipeline running. Backed up state.json + cost-log.json → $BK/*-$TS.json"

# ── STEP 1: Scout (has-website) ──────────────────────────────────────────────
echo ""
echo "[1/4] Scout — website-bearing $TRADE in $CITY (budget \$$BUDGET)…"
node scripts/scout.js --city "$CITY" --trade "$TRADE" --mode has-website --budget "$BUDGET" --force || {
  echo "  Scout returned no qualifying leads. Try a bigger metro, or loosen with"
  echo "  --min-reviews 3 --min-rating 3.5. Nothing else ran; state is untouched."
  exit 0
}

# ── STEP 2: contact-scraper (--deep) ─────────────────────────────────────────
echo ""
echo "[2/4] Contact-scraper — harvesting emails from those sites (free)…"
node scripts/contact-scraper.js --deep

# ── STEP 3: Diagnoser ────────────────────────────────────────────────────────
echo ""
echo "[3/4] Diagnoser — briefs for newly email-capable leads…"
node scripts/diagnoser.js --force

# ── STEP 4: Checker ──────────────────────────────────────────────────────────
echo ""
echo "[4/4] Checker — approving messages…"
node scripts/checker.js --force

# ── Report ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
node -e '
const fs=require("fs");
const s=JSON.parse(fs.readFileSync("state.json","utf8"));
const checked=new Set(s.queue.filter(l=>l.status==="checked").map(l=>l.lead_id));
let n=0; const names=[];
for(const f of fs.readdirSync("queue").filter(x=>x.endsWith("-brief.json"))){
  let b; try{b=JSON.parse(fs.readFileSync("queue/"+f));}catch{continue;}
  if(b.checker_approved&&b.channel==="email"&&(b.email||"").trim()&&checked.has(f.replace("-brief.json",""))){ n++; if(names.length<40) names.push("  ✉ "+b.business_name+" ("+b.email+")"); }
}
console.log("Approved EMAIL leads now ready to send: "+n);
if(names.length) console.log(names.join("\n"));
'
echo "────────────────────────────────────────────────────"
echo "Next: node scripts/pitcher.js --dry-run --force --channel email   (preview)"
echo "Then: node scripts/pitcher.js --force --channel email             (send, 30/day cap)"
echo ""
