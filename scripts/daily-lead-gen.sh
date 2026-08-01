#!/usr/bin/env bash
# daily-lead-gen.sh — unattended morning lead pipeline, one day out of phase.
#
#   [A] send YESTERDAY's approved batch   (nothing sends without approval)
#   [B] scrape TODAY's market             Scout -> contact-scraper -> Diagnoser
#                                         -> Checker -> sheet-log
#   [C] email Dave today's companies + contacts to approve
#
# The offset is deliberate: no contact is ever emailed the same morning it was
# scraped, and no batch sends unless Dave approved it during the day. A batch
# left un-reviewed simply never sends — silence is the safe default.
#
#   Day N 06:30  scrape market N -> batch N "pending" -> approval email
#   Day N daytime  node scripts/approve-batch.js <date>
#   Day N+1 06:30  send batch N, scrape market N+1
#
# Market is chosen automatically by scripts/lib/market-rotation.js (Colorado
# first, rotating trades within each metro), so no human picks a city.
#
# Usage:
#   bash scripts/daily-lead-gen.sh              # real run
#   bash scripts/daily-lead-gen.sh --dry-run    # pick target + report, spend nothing
#
# Mac only — Outscraper and contractor sites are both blocked from the container.

set -uo pipefail          # NOT -e: a failing stage must still produce a report
cd "$(dirname "$0")/.."   # repo root

DRY_RUN=""
[ "${1:-}" = "--dry-run" ] && DRY_RUN="--dry-run"

DATE="$(date +%Y-%m-%d)"
RUN_DIR="logs/daily-lead-gen"
RESULTS="$RUN_DIR/$DATE.json"
mkdir -p "$RUN_DIR"

# Per-run Outscraper cap. 30 sends/day needs ~115 raw at measured yield
# (100 raw -> 67 qualifying -> ~26 clean emails); $0.12 buys 120.
BUDGET="${LEADGEN_BUDGET:-0.12}"

echo "╔══════════════════════════════════════════════════╗"
echo "║  Daily lead-gen — $DATE ${DRY_RUN}"
echo "╚══════════════════════════════════════════════════╝"

# ── STEP 0: safety ───────────────────────────────────────────────────────────
# state.json and cost-log.json are live working files. A concurrent pipeline
# process plus this one has already caused real data loss once (see root
# CLAUDE.md's orchestration rules).
echo ""
echo "[0/7] Preflight…"
if ps aux | grep -E 'node (scripts/(pitcher|drip|scout|checker|diagnoser|contact-scraper)|agents/)' | grep -v grep >/dev/null; then
  echo "  ✗ Another pipeline process is running. Aborting — state is untouched."
  node -e '
    const fs=require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      date: process.argv[2],
      error: "Aborted: another pipeline process was already running.",
    }, null, 2));
  ' "$RESULTS" "$DATE"
  node scripts/daily-pipeline-report.js "$RESULTS" $DRY_RUN
  exit 1
fi
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BK="logs/state-backups"
mkdir -p "$BK"
cp state.json "$BK/state-$TS.json"
cp config/cost-log.json "$BK/cost-log-$TS.json"
echo "  ✓ Clear. Backed up state.json + cost-log.json → $BK/*-$TS.json"

# ── STEP 1: send yesterday's APPROVED batch ──────────────────────────────────
# Approved-only by construction: pitcher --batch builds its allowlist from
# lead-batches.json and that allowlist is empty unless status is 'approved'.
# An un-reviewed batch therefore sends nothing rather than defaulting to send.
echo ""
echo "[1/7] Sending previously approved batch…"
SEND_BATCH="$(node -e '
  const { nextSendableBatch } = require("./scripts/lib/lead-batches");
  const b = nextSendableBatch();
  console.log(b ? b.date + "|" + b.leads.length : "|0");
')"
SEND_DATE="$(echo "$SEND_BATCH" | cut -d'|' -f1)"
SEND_N="$(echo "$SEND_BATCH" | cut -d'|' -f2)"

SENT_COUNT=0
if [ -z "$SEND_DATE" ]; then
  echo "  → nothing approved and waiting. Skipping send."
else
  echo "  → batch $SEND_DATE ($SEND_N contacts, approved)"
  if [ -n "$DRY_RUN" ]; then
    node scripts/pitcher.js --dry-run --force --channel email --batch "$SEND_DATE"
  else
    node scripts/pitcher.js --force --channel email --batch "$SEND_DATE"
    if [ $? -eq 0 ]; then
      node -e '
        const { markSent } = require("./scripts/lib/lead-batches");
        const r = markSent(process.argv[1]);
        console.log(r.ok ? "  ✓ batch " + process.argv[1] + " marked sent" : "  ! " + r.reason);
      ' "$SEND_DATE"
      SENT_COUNT="$SEND_N"
    else
      echo "  ! Pitcher exited non-zero — batch left approved so it retries tomorrow."
    fi
  fi
fi

# ── STEP 1b: drip follow-ups ─────────────────────────────────────────────────
# Drip was previously scheduled nowhere — not cron, not launchd, not here — so
# a lead that got the initial send never received steps 2-4 of the sequence it
# was enrolled in. On 2026-07-31 that left 17 leads frozen at drip_d1_sent
# since 07-09, days from the 26-day dead_after_days sweep that would have
# retired them having heard from us exactly once.
#
# Weekdays only. Follow-ups landing Saturday morning read as automated and
# convert worse, and these are contractors — Monday is the working day. `date
# +%u` gives 1-7 with 6=Sat, 7=Sun.
#
# --force is deliberate even though this is now automated: drip-config keeps
# auto_run:false so a stray manual `node scripts/drip.js` still refuses to
# send. The scheduled path opts in explicitly; the manual path stays guarded.
# drip.js enforces its own daily_limit (20) and per-send stagger.
echo ""
DOW="$(date +%u)"
if [ "$DOW" -ge 6 ]; then
  echo "[1b/7] Drip — skipped, weekend (follow-ups resume Monday)."
elif [ -n "$DRY_RUN" ]; then
  echo "[1b/7] Drip — preview only…"
  node scripts/drip.js --dry-run --force
else
  echo "[1b/7] Drip — sending due follow-ups…"
  node scripts/drip.js --force
  [ $? -eq 0 ] || echo "  ! Drip exited non-zero — due follow-ups stay queued for tomorrow."
fi

# ── STEP 2: choose today's market ────────────────────────────────────────────
echo ""
echo "[2/7] Choosing market from rotation…"
TARGET="$(node -e '
  const { nextTarget, rotationStatus } = require("./scripts/lib/market-rotation");
  const t = nextTarget();
  const s = rotationStatus();
  if (!t) { console.log(["", "", s.done, s.remaining].join("|")); process.exit(0); }
  console.log([t.city, t.trade, s.done, s.remaining].join("|"));
')"
CITY="$(echo "$TARGET" | cut -d'|' -f1)"
TRADE="$(echo "$TARGET" | cut -d'|' -f2)"
ROT_DONE="$(echo "$TARGET" | cut -d'|' -f3)"
ROT_LEFT="$(echo "$TARGET" | cut -d'|' -f4)"

if [ -z "$CITY" ]; then
  echo "  ✗ Rotation exhausted — every city × trade combination is worked."
  node -e '
    const fs=require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      date: process.argv[2], rotationExhausted: true,
      rotation: { done: Number(process.argv[3]), remaining: Number(process.argv[4]) },
    }, null, 2));
  ' "$RESULTS" "$DATE" "$ROT_DONE" "$ROT_LEFT"
  node scripts/daily-pipeline-report.js "$RESULTS" $DRY_RUN
  exit 0
fi
echo "  → $TRADE in $CITY   ($ROT_DONE worked, $ROT_LEFT remaining)"

if [ -n "$DRY_RUN" ]; then
  echo ""
  echo "DRY RUN — target chosen, nothing spent or written."
  node -e '
    const fs=require("fs");
    const [,, out, date, city, trade, done, left] = process.argv;
    fs.writeFileSync(out, JSON.stringify({
      date, city, trade, dryRun: true,
      stages: {}, readyToSend: null,
      rotation: { done: Number(done), remaining: Number(left) },
    }, null, 2));
  ' "$RESULTS" "$DATE" "$CITY" "$TRADE" "$ROT_DONE" "$ROT_LEFT"
  node scripts/daily-pipeline-report.js "$RESULTS" --dry-run
  exit 0
fi

# Snapshot counts so each stage's yield is measured, not guessed.
BEFORE_LEADS="$(ls leads/ 2>/dev/null | wc -l | tr -d ' ')"

# ── STEP 2: Scout ────────────────────────────────────────────────────────────
echo ""
echo "[3/7] Scout — has-website $TRADE in $CITY (cap \$$BUDGET)…"
node scripts/scout.js --city "$CITY" --trade "$TRADE" --mode has-website --budget "$BUDGET" --force
SCOUT_RC=$?

# ── STEP 3: contact-scraper ──────────────────────────────────────────────────
echo ""
echo "[4/7] Contact-scraper --deep — harvesting emails (free)…"
node scripts/contact-scraper.js --deep

# ── STEP 4: Diagnoser ────────────────────────────────────────────────────────
echo ""
echo "[5/7] Diagnoser…"
node scripts/diagnoser.js --force

# ── STEP 5: Checker ──────────────────────────────────────────────────────────
echo ""
echo "[6/7] Checker…"
node scripts/checker.js --force

# ── STEP 6: Google Sheets CRM ────────────────────────────────────────────────
# Not called by pitcher or drip — it has always been a manual step, which is
# why the Sheet drifts. Wiring it in here is what keeps the CRM current.
echo ""
echo "[7/7] Sheet-log — syncing Google Sheets CRM…"
node scripts/sheet-log.js
SHEET_RC=$?


# ── Measure, record today's batch, report ────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
node scripts/daily-run-measure.js \
  "$RESULTS" "$DATE" "$CITY" "$TRADE" "$ROT_DONE" "$ROT_LEFT" "$SCOUT_RC" "$SHEET_RC" "$SENT_COUNT"

node scripts/daily-pipeline-report.js "$RESULTS"
echo "────────────────────────────────────────────────────"
echo ""
echo "Today's scrape is PENDING your approval. Review the emailed list, then:"
echo "  node scripts/approve-batch.js $DATE"
echo ""
echo "Approved batches send automatically on the next 6:30am run."
