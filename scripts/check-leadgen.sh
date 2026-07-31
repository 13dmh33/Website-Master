#!/usr/bin/env bash
# check-leadgen.sh — is the 6:30am lead pipeline actually wired up, and what
# would it send tomorrow morning?
#
# Read-only. Spends nothing, sends nothing, writes nothing. Safe to run at any
# time, including while a pipeline process is going.
#
# Answers, in order:
#   1. Is the launchd job loaded, and does its installed plist still hold the
#      __REPO_PATH__ placeholders that mean it was never finished?
#   2. Will the Mac be awake at 06:30? launchd does NOT run a missed
#      StartCalendarInterval job while asleep — it fires late on wake, which
#      can push a real send into the afternoon.
#   3. Does a batch store exist, and what is pending / approved / sent?
#   4. What exactly goes out at the next 06:30 run?
#   5. Which market gets scraped next.
#   6. Did the last run leave any trace.
#
# Usage:  bash scripts/check-leadgen.sh
#
# Mac is where this matters — config/lead-batches.json is written by
# daily-lead-gen.sh on the Mac and is not tracked in git, so a container clone
# can never see the real approval state. Run it there.

cd "$(dirname "$0")/.." || exit 1

LABEL="com.trevo.leadgen.daily"
INSTALLED="$HOME/Library/LaunchAgents/$LABEL.plist"
STORE="config/lead-batches.json"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Lead-gen preflight — $(date +%Y-%m-%d\ %H:%M)              ║"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. Is the job installed and loaded? ──────────────────────────────────────
echo ""
echo "[1/6] launchd job"
JOB_LOADED=0
if ! command -v launchctl >/dev/null 2>&1; then
  warn "No launchctl — not a Mac. Scheduling can't be checked from here."
  note "Run this on the Mac; that is the machine that sends."
else
  if launchctl list 2>/dev/null | grep -q "$LABEL"; then
    ok "$LABEL is LOADED"
    JOB_LOADED=1
    # Column 2 of `launchctl list` is the last exit status.
    LAST_RC="$(launchctl list 2>/dev/null | grep "$LABEL" | awk '{print $2}')"
    [ -n "$LAST_RC" ] && [ "$LAST_RC" != "0" ] && \
      warn "last exit status $LAST_RC — the job ran and failed"
  else
    bad "$LABEL is NOT loaded — nothing will run at 6:30am"
    JOB_LOADED=0
  fi

  if [ -f "$INSTALLED" ]; then
    ok "plist installed at ~/Library/LaunchAgents/"
    if grep -q '__REPO_PATH__\|__NODE_PATH__' "$INSTALLED"; then
      bad "installed plist STILL HAS PLACEHOLDERS — it cannot work as-is"
      note "Replace __REPO_PATH__ with $(pwd)"
    fi
  else
    bad "no plist at $INSTALLED — never installed"
  fi
fi

# ── 2. Will the Mac be awake at 06:30? ───────────────────────────────────────
echo ""
echo "[2/6] Wake schedule"
if command -v pmset >/dev/null 2>&1; then
  SCHED="$(pmset -g sched 2>/dev/null)"
  if echo "$SCHED" | grep -qi 'wake\|poweron'; then
    ok "a wake/poweron event is scheduled"
    echo "$SCHED" | sed 's/^/    /'
  else
    warn "no wake scheduled — a sleeping Mac fires the job LATE, not on time"
    note "sudo pmset repeat wakeorpoweron MTWRFSU 06:25:00"
  fi
else
  note "pmset unavailable (not a Mac) — skipped"
fi

# ── 3. The batch store ───────────────────────────────────────────────────────
echo ""
echo "[3/6] Approval store ($STORE)"
if [ ! -f "$STORE" ]; then
  bad "does not exist — no batch has ever been recorded on this machine"
  note "Only scripts/daily-lead-gen.sh creates batches. No store = it never ran."
else
  ok "exists"
  node -e '
    const { loadStore, STATUS } = require("./scripts/lib/lead-batches");
    const all = Object.values(loadStore().batches);
    if (!all.length) { console.log("    store is empty — no batches recorded"); process.exit(0); }
    const by = {};
    for (const b of all) by[b.status] = (by[b.status] || 0) + 1;
    console.log("    " + all.length + " batch(es): " +
      Object.entries(by).map(([k, v]) => v + " " + k).join(", "));
    all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).forEach(b => {
      console.log("    " + b.date + "  [" + b.status + "]  " + b.leads.length + " contacts");
    });
  '
fi

# ── 4. What actually goes out next ───────────────────────────────────────────
echo ""
echo "[4/6] What sends at the next 6:30am run"
node -e '
  const { nextSendableBatch, pendingBatches } = require("./scripts/lib/lead-batches");
  const send = nextSendableBatch();
  const pend = pendingBatches();
  if (send) {
    console.log("  \x1b[32m✓\x1b[0m batch " + send.date + " is APPROVED — " +
      send.leads.length + " contacts will be emailed");
    send.leads.slice(0, 5).forEach(l =>
      console.log("      " + (l.business_name || "(no name)").padEnd(38) + " " + l.email));
    if (send.leads.length > 5) console.log("      … " + (send.leads.length - 5) + " more");
  } else {
    console.log("  \x1b[33m!\x1b[0m NOTHING will be sent — no approved, unsent batch exists");
  }
  if (pend.length) {
    console.log("");
    console.log("  " + pend.length + " batch(es) awaiting your approval:");
    pend.forEach(b => console.log("      node scripts/approve-batch.js " + b.date +
      "   (" + b.leads.length + " contacts)"));
    console.log("  Review the full list first:  node scripts/approve-batch.js --show " + pend[0].date);
  }
' 2>/dev/null || bad "could not read batch state"

# ── 5. Next market ───────────────────────────────────────────────────────────
echo ""
echo "[5/6] Next market in the rotation"
node -e '
  const { nextTarget, rotationStatus } = require("./scripts/lib/market-rotation");
  const t = nextTarget(); const s = rotationStatus();
  console.log(t ? "    " + t.trade + " in " + t.city : "    rotation EXHAUSTED");
  console.log("    " + s.done + " of " + s.total + " combos worked, " + s.remaining + " remaining");
' 2>/dev/null || bad "could not read rotation"

# ── 6. Evidence of past runs ─────────────────────────────────────────────────
echo ""
echo "[6/6] Past runs"
if [ -d logs/daily-lead-gen ]; then
  N="$(ls logs/daily-lead-gen/*.json 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$N" -gt 0 ]; then
    ok "$N run(s) recorded — most recent:"
    ls -t logs/daily-lead-gen/*.json 2>/dev/null | head -3 | sed 's/^/    /'
  else
    warn "logs/daily-lead-gen/ exists but holds no run results"
  fi
  if [ -s logs/daily-lead-gen/launchd.err.log ]; then
    warn "launchd stderr is non-empty — last lines:"
    tail -5 logs/daily-lead-gen/launchd.err.log | sed 's/^/    /'
  fi
else
  bad "logs/daily-lead-gen/ missing — the pipeline has never run on this machine"
fi

# ── Verdict ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────"
if [ ! -f "$STORE" ] && [ "$JOB_LOADED" = "0" ]; then
  echo "VERDICT: not wired up. No job loaded and no batch store."
  echo "Tomorrow 6:30am sends nothing. To start it:"
  echo ""
  echo "  sed -e \"s|__REPO_PATH__|\$(pwd)|g\" \\"
  echo "      deploy/com.trevo.leadgen.daily.plist > ~/Library/LaunchAgents/$LABEL.plist"
  echo "  launchctl load ~/Library/LaunchAgents/$LABEL.plist"
  echo "  sudo pmset repeat wakeorpoweron MTWRFSU 06:25:00"
  echo ""
  echo "First run scrapes and emails you a list; that batch sends the day AFTER"
  echo "you approve it. Dry-run it now with no spend:"
  echo "  bash scripts/daily-lead-gen.sh --dry-run"
else
  echo "Approve a pending batch:  node scripts/approve-batch.js <date>"
  echo "Approve everything:       node scripts/approve-batch.js --all"
fi
echo "────────────────────────────────────────────────────"
echo ""
