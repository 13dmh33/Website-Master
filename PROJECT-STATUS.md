# Trevo Advisors — Project Status

**Last updated:** 2026-06-01 (Denver plumbers sent — first email batch)
**Branch:** `claude/kind-hypatia-3YzM0`

---

## 🟢 Live & Working

| Script | Status | Notes |
|---|---|---|
| scout.js | ✅ Live | Run on Mac — Outscraper blocked from container |
| diagnoser.js | ✅ Live | Container — dual-channel: sets email + secondary SMS when both contacts available |
| checker.js | ✅ Live | Container — validates primary + secondary messages for unfilled placeholders |
| pitcher.js | ✅ Live | Mac — email first; SMS auto-queued 4h later; per-channel sent tracking |
| builder.js | ✅ Live | Container |
| filmer.js | ✅ Live | Container |
| mobile.js | ✅ Live | Container — auto-send, no approval gate |
| reporter.js | ✅ Live | Mac — morning email, shows email/SMS split + per-service costs + drip stats |
| drip.js | ✅ Live | Mac — 4-step sequence (d1/d1b/d1c/d2), per-channel, daily limit 20 |

---

## 📊 Current Numbers (June 2026)

| Metric | Value |
|---|---|
| SMS sent (MTD) | 18 (Denver electricians) |
| Email sent (MTD) | 15 (Denver plumbers — sent 2026-06-01) |
| Replies received | 0 (watching Twilio + Zoho) |
| Leads in queue | 1 (D&J Enterprises — 1 failed SMS send, retry pending) |
| Deals closed | 0 |
| MTD cost | ~$0.28 (Twilio SMS + Outscraper) |

---

## 📬 Batch 1 — Denver Electricians (2026-06-01)

- **19 leads** scouted, diagnosed, approved
- **18/19 sent** via Twilio SMS (template s1)
- **1 error:** D&J Enterprises — retry pending

## 📬 Batch 2 — Denver Plumbers (2026-06-01)

- **15 leads** scouted, diagnosed, approved
- **15/15 sent** via Zoho email (template e1 — first email batch)
- Dual-channel leads will get SMS follow-up after 4h delay

---

## ✅ Completed Milestones

- [x] All 8 scripts built and tested
- [x] Template vault: 5 SMS + 5 email templates with A/B rotation
- [x] Twilio upgraded from trial → paid account
- [x] Email switched from Resend → Zoho SMTP (already owned)
- [x] Morning report emailer live — sent to 13dmh33@gmail.com
- [x] Cost tracking across all agents (cost-log.json)
- [x] queue/*.json tracked in git (Pitcher can run on any machine)
- [x] **First real SMS sends** — 18 Denver electricians (2026-06-01)
- [x] **Phase 1+2 complete** — dual-channel routing, per-channel counters, report email/SMS split
- [x] **Email deliverability** — SPF + DKIM + DMARC all set on trevoadvisors.com (OpenSRS DNS, 2026-06-01)
- [x] **GitHub PAT** — Mac can push to git without password prompts
- [x] **Cron job** — morning reporter runs at 7am daily on Mac
- [x] **leads/*.json tracked in git** — Scout output syncs to container automatically
- [x] **SMS templates trimmed to 1 segment** — all ≤160 chars; s6 catch-all added (no data requirements)
- [x] **[First Name] removed** — all templates open with "Hey," — no bad name substitution
- [x] **First email batch** — 15 Denver plumbers sent via Zoho SMTP (2026-06-01)
- [x] **Drip campaign** — drip.js live, 8 templates loaded (d1/d1b/d1c/d2 × email + SMS), run on Mac with --force

---

## ⚠️ Gaps & Risks

| Item | Risk Level | Notes |
|---|---|---|
| **Drip not yet run** | 🟡 Medium | drip.js is live. Run `node scripts/drip.js --dry-run --force` on Mac to preview first due messages. First d1 sends will be due ~Day 4 (Jun 5). |
| **No Loom links in pitch yet** | 🔴 High | Filmer generates instructions but Dave hasn't recorded yet. Attaching a custom mockup video is the main differentiator — without it the pitch is just another cold message. |
| **Reply handling is manual** | 🟡 Medium | Twilio console must be checked manually for SMS replies. Fine at 33 sends, becomes a bottleneck above 100/week. Twilio webhook is the fix. |
| **Twilio paid account** | 🟡 Medium | D&J Enterprises failure was a trial-account limit. Confirm paid upgrade is active before scaling volume. |
| **state.json scaling** | 🟢 Low | Flat file is fine to ~1,000 leads (~8–10 weeks at current pace). SQLite migration documented for when needed. |

---

## 📅 Recommended Next 7 Days

| Day | Priority | Action |
|---|---|---|
| Today–Tue | 🔴 | Monitor first batch for replies (Twilio console + Zoho inbox); drip.js is live — **first d1 sends due ~Jun 5** (day 4 from Jun 1 sends) |
| Wed | 🔴 | Confirm Twilio is on paid account; retry D&J Enterprises; run second Scout batch (new city or second Denver trade) |
| Thu | 🟡 | Record first Loom walkthrough for a real mockup and attach to an active lead sequence |
| Fri | 🟡 | Set up Cal.com link (`CALCOM_LINK=` in `.env.local`) so Mobile agent can book calls from positive replies |
| Weekend | 🟢 | Review morning reports for template performance; draft reply scripts for first positive responses |

---

## 🔜 Open Action Items

| Priority | Task | Command / Action |
|---|---|---|
| 🟡 Medium | Run first drip batch on Mac (Jun 5) | `node scripts/drip.js --dry-run --force` to preview, then `node scripts/drip.js --force` |
| 🔴 High | Record first Loom + attach to active leads | Run `node scripts/filmer.js --force`, record walkthrough, submit URL |
| 🟡 Medium | Retry D&J Enterprises SMS | Mac: `git pull && node scripts/pitcher.js --force` |
| 🟡 Medium | Scout second batch | Mac: `node scripts/scout.js --city "..." --trade ... --force` |
| 🟡 Medium | Set up Twilio reply webhook | Auto-detect inbound SMS → update messages JSON (~1.5hr build) |
| 🟡 Medium | Set up Cal.com link | Add `CALCOM_LINK=` to `.env.local` on Mac |
| 🟢 Low | Tighten DMARC after 30 days | OpenSRS DNS → change `p=none` to `p=quarantine` |

---

## 🔁 Daily Workflow (Short Version)

```bash
# MAC — Scout new leads
node scripts/scout.js --city "..." --trade ... --force
git add leads/ state.json config/cost-log.json && git commit && git push

# CONTAINER — AI processing
node scripts/diagnoser.js --force    # sets primary + secondary channels
node scripts/checker.js --force
node scripts/builder.js --force      # paste prompts → lovable.dev
node scripts/filmer.js --force       # record Loom

# MAC — Send (run 1: emails go out)
git pull && node scripts/pitcher.js --force
# MAC — Send (run 2: ~4h later, SMS follow-ups go out to dual-channel leads)
node scripts/pitcher.js --force

# MAC — Drip (run daily; first sends due Day 4 from initial send)
node scripts/drip.js --force

git add state.json config/ && git commit && git push

# MORNING (MAC / cron at 7am)
node scripts/reporter.js
```

---

## 💰 Cost Summary (June 2026 MTD)

| Service | Spent | Cap |
|---|---|---|
| Anthropic API | $0.013 | $8/mo (diagnoser + checker) |
| Twilio SMS | $0.14 | none (~$0.0079/msg, 1 seg) |
| Zoho Email | $0.00 | flat subscription |
| Outscraper | $0.06 | $10/mo |
| **Total** | **~$0.21** | |
