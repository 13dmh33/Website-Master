#!/usr/bin/env bash
# Daily pipeline runner — runs all agents in order.
# Usage: ./run-daily.sh
# Add --dry-run to preview Pitcher output without sending.

set -euo pipefail

DRY_RUN=${1:-""}

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         Maps Agency — Daily Run                  ║"
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
echo "[1/8] Scout — scraping $TRADE leads in $CITY..."
node scripts/scout.js --city "$CITY" --trade "$TRADE" --force
echo "✓ Scout done"

# ── STEP 2: Free enrichment (owner + contact, BEFORE paid Apollo) ─────────────
# "Free before paid": fill owner name / email / phone / socials from free sources
# so Diagnoser can route more leads to email. All are additive (never overwrite)
# and safe to re-run. Guarded with `|| true` — enrichment is best-effort and must
# never abort the outreach run. Mac-only (these APIs are blocked from the container).
echo ""
echo "[2/8] Enrichment — free owner/contact lookup before paid steps..."
# Owner NAME (+ CO licensure) from public records — works with NO website. Additive.
node scripts/owner-resolver.js --source co-sos  --live || true
node scripts/owner-resolver.js --source co-dora --live || true
# Email / phone / name / socials from the lead's OWN website (has-website leads).
node scripts/contact-scraper.js --deep || true
# Owner name + domain → ranked email guesses. Staged to email_candidates for review;
# NOT auto-promoted to outreach (add --trust-mx to promote top MX-gated guesses).
node scripts/email-permuter.js --live || true
echo "✓ Enrichment done"

# ── STEP 3: Diagnoser ────────────────────────────────────────────────────────
echo ""
echo "[3/8] Diagnoser — generating briefs for new leads..."
node scripts/diagnoser.js --force
echo "✓ Diagnoser done"

# ── STEP 4: Checker ──────────────────────────────────────────────────────────
echo ""
echo "[4/8] Checker — evaluating and approving messages..."
node scripts/checker.js --force
echo "✓ Checker done"

# ── STEP 5: Builder ──────────────────────────────────────────────────────────
echo ""
echo "[5/8] Builder — generating Lovable prompts for top 5 leads..."
node scripts/builder.js --force
echo ""
echo "  ► MANUAL STEP: Copy each prompt from /mockups/*-lovable-prompt.txt"
echo "    and paste into lovable.dev to build the site."
echo "  ► When done, record the URL with:"
echo "    node scripts/builder.js --submit --lead LEAD_ID --url LOVABLE_URL"
echo ""
read -rp "  Press Enter when all mockups are submitted (or skip with Enter)..."

# ── STEP 6: Filmer ───────────────────────────────────────────────────────────
echo ""
echo "[6/8] Filmer — generating Loom recording instructions..."
node scripts/filmer.js --force
echo ""
echo "  ► MANUAL STEP: Record a 60-second Loom for each mockup."
echo "    Instructions are in /mockups/*-video.txt"
echo "  ► When done, submit with:"
echo "    node scripts/filmer.js --submit --lead LEAD_ID --url loom:LOOM_URL"
echo ""
read -rp "  Press Enter when all videos are submitted (or skip with Enter)..."

# ── STEP 7: Pitcher ──────────────────────────────────────────────────────────
echo ""
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[7/8] Pitcher — DRY RUN (previewing messages, nothing sent)..."
  node scripts/pitcher.js --force --dry-run
  echo ""
  echo "  ► Dry run complete. Remove --dry-run from your command to send for real."
else
  echo "[7/8] Pitcher — sending approved messages..."
  node scripts/pitcher.js --force
  echo "✓ Pitcher done"
fi

# ── STEP 8: Drip ─────────────────────────────────────────────────────────────
echo ""
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "[8/8] Drip — DRY RUN (previewing follow-ups, nothing sent)..."
  node scripts/drip.js --force --dry-run
  echo ""
  echo "  ► Dry run complete. Remove --dry-run to send for real."
else
  echo "[8/8] Drip — sending follow-up sequence..."
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
