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
| reporter.js | ✅ Live | Mac — morning email, shows email/SMS split + per-service costs |

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

---

## 🔜 Immediate Next Steps

| Priority | Task | Command / Action |
|---|---|---|
| 🟡 Medium | Retry D&J Enterprises SMS | `node scripts/pitcher.js --force` on Mac after git pull |
| 🟡 Medium | Set up Twilio reply webhook | Auto-detect inbound SMS → update messages JSON |
| 🟡 Medium | Scout next city/trade | `node scripts/scout.js --city "..." --trade ... --force` on Mac |
| 🟡 Medium | Write drip campaign copy (4 templates) | See PROJECT-ROADMAP.md Phase 3 |
| 🟢 Low | Set up Cal.com link | Add `CALCOM_LINK=` to `.env.local` |

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
