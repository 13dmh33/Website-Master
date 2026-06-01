# Trevo Advisors — Project Status

**Last updated:** 2026-06-01
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
| SMS sent (MTD) | 18 |
| Email sent (MTD) | 0 (no email leads yet — need plumber/HVAC Scout run) |
| Replies received | 0 (watching Twilio console) |
| Leads in queue | 1 (D&J Enterprises — 1 failed SMS send) |
| Deals closed | 0 |
| MTD cost | $0.14 (Twilio SMS only) |

---

## 📬 First Batch — Denver Electricians (2026-06-01)

- **19 leads** scouted, diagnosed, approved
- **18/19 sent** via Twilio SMS (template s1 — "The reputation gap")
- **1 error:** D&J Enterprises — trial-account timing issue; retry pending
- Replies expected over next 24–72 hours — check Twilio console → Monitor → Messaging

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

---

## ⚠️ Before Sending Email at Scale

Email deliverability setup required — without it, cold email hits spam ~80% of the time:

1. **SPF record** — add to trevoadvisors.com DNS (Zoho provides the value)
2. **DKIM** — set up in Zoho Mail → Settings → Domains → verify domain
3. **DMARC** — add TXT record: `v=DMARC1; p=none; rua=mailto:dave@trevoadvisors.com`

Check current status: mxtoolbox.com/spf and mxtoolbox.com/dkim

---

## 🔜 Immediate Next Steps

| Priority | Task | Command / Action |
|---|---|---|
| 🔴 High | Email deliverability — SPF/DKIM/DMARC | Zoho Mail → Settings → Domains (see above) |
| 🔴 High | Set up GitHub PAT on Mac | github.com/settings/tokens → classic → repo scope |
| 🔴 High | Set up cron for morning report | `crontab -e` → `0 7 * * * cd ~/Website-Master && /path/to/node scripts/reporter.js` |
| 🟡 Medium | Scout plumbers/HVAC for first email batch | `node scripts/scout.js --city "Denver, CO" --trade plumber --force` on Mac |
| 🟡 Medium | Retry D&J Enterprises SMS | `node scripts/pitcher.js --force` on Mac |
| 🟡 Medium | Set up Twilio reply webhook | Auto-detect inbound SMS → update messages JSON |
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
| Anthropic API | $0.00 | $8/mo (diagnoser + checker) |
| Twilio SMS | $0.14 | none (~$0.0079/msg) |
| Zoho Email | $0.00 | flat subscription |
| Outscraper | $0.00 | $10/mo |
| **Total** | **$0.14** | |

*Anthropic costs will populate after next Diagnoser/Checker run — cost-tracker.js now active.*
