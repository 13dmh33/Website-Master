#!/usr/bin/env bash
# Daily pipeline runner — runs all agents in order.
# Usage: ./run-daily.sh
# Add --dry-run to preview Pitcher output without sending.

set -euo pipefail

DRY_RUN=${1:-""}

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       Trevo Advisors — Daily Run                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── STEP 0: Preflight ────────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found."
  echo "Copy .env.local.example → .env.local and fill in your API keys first."
  exit 1
fi

echo "City and trade are required at runtime."
read -rp "City  (e.g. Phoenix): " CITY
read -rp "Trade (e.g. plumber): " TRADE

if [ -z "$CITY" ] || [ -z "$TRADE" ]; then
  echo "City and trade are required. Exiting."
  exit 1
fi

echo ""
echo "Running for: $TRADE in $CITY"
echo "────────────────────────────────────────────────────"

# ── STEP 1: Scout ────────────────────────────────────────────────────────────
echo ""
echo "[1/7] Scout — scraping $TRADE leads in $CITY..."
node scripts/scout.js --city "$CITY" --trade "$TRADE" --force
echo "✓ Scout done"

# ── STEP 2: Diagnoser ────────────────────────────────────────────────────────
echo ""
echo "[2/7] Diagnoser — generating briefs for new leads..."
node scripts/diagnoser.js --force
echo "✓ Diagnoser done"

# ── STEP 3: Checker ──────────────────────────────────────────────────────────
echo ""
echo "[3/7] Checker — evaluating and approving messages..."
node scripts/checker.js --force
echo "✓ Checker done"

# ── STEP 4: Builder ──────────────────────────────────────────────────────────
echo ""
echo "[4/7] Builder — generating Lovable prompts for top 5 leads..."
node scripts/builder.js --force
echo ""
echo "  ► MANUAL STEP: Copy each prompt from /mockups/*-lovable-prompt.txt"
echo "    and paste into lovable.dev to build the site."
echo "  ► When done, record the URL with:"
echo "    node scripts/builder.js --submit --lead LEAD_ID --url LOVABLE_URL"
echo ""
read -rp "  Press Enter when all mockups are submitted (or skip with Enter)..."

# ── STEP 5: Filmer ───────────────────────────────────────────────────────────
echo ""
echo "[5/7] Filmer — generating Loom recording instructions..."
node scripts/filmer.js --force
echo ""
echo "  ► MANUAL STEP: Record a 60-second Loom for each mockup."
echo "    Instructions are in /mockups/*-video.txt"
echo "  ► When done, submit with:"
echo "    node scripts/filmer.js --submit --lead LEAD_ID --url loom:LOOM_URL"
echo ""
read -rp "  Press Enter when all videos are submitted (or skip with Enter)..."

# ── STEP 6: Pitcher ──────────────────────────────────────────────────────────
echo ""
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[6/7] Pitcher — DRY RUN (previewing messages, nothing sent)..."
  node scripts/pitcher.js --force --dry-run
  echo ""
  echo "  ► Dry run complete. Remove --dry-run from your command to send for real."
else
  echo "[6/7] Pitcher — sending approved messages..."
  node scripts/pitcher.js --force
  echo "✓ Pitcher done"
fi

# ── STEP 7: Drip ─────────────────────────────────────────────────────────────
echo ""
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[7/7] Drip — DRY RUN (previewing follow-ups, nothing sent)..."
  node scripts/drip.js --force --dry-run
  echo ""
  echo "  ► Dry run complete. Remove --dry-run to send for real."
else
  echo "[7/7] Drip — sending follow-up sequence..."
  node scripts/drip.js --force
  echo "✓ Drip done"
fi

# ── DONE ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "Daily run complete."
echo ""
echo "Next steps:"
echo "  • Check /messages/ for replies and run: node scripts/mobile.js"
echo "  • Review flagged messages: grep -rl 'human_review' queue/"
echo "  • Check daily stats in state.json"
echo "════════════════════════════════════════════════════"
echo ""
