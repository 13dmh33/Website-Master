# Trevo Advisors — Build Roadmap

**Created:** 2026-06-01
**Status:** Planning — do not build until approved

---

## Scope

Three additions to the pipeline:

1. **Email Outreach** — send via Zoho SMTP when email is available; SMS when it's not
2. **Report Enhancement** — show email vs SMS breakdown in morning report
3. **Drip Campaign** — automated follow-up sequence for non-responders (copy provided by Dave)

---

## Phase 1 — Email Outreach
**Estimated time: 2.5 hours**

### What's already done
- Zoho SMTP configured in pitcher.js ✅
- Email send function working (tested) ✅
- Email field captured by Scout ✅ (passed through full pipeline)

### What needs to change

**Task 1.1 — Channel routing logic** (1 hr)
Currently: trade determines channel (plumber/HVAC → email; electrician/roofer → SMS)
Change to: email availability determines channel
- If lead has email → send email (any trade)
- If lead has no email → send SMS (any trade)
- If lead has both → send email (email is higher-converting for cold B2B)
- Decision point: Do you want email-only, SMS-only, or both when both are available?

Files: `scripts/diagnoser.js` (channel assignment logic)

**Task 1.2 — Scout: ensure email captured for all trades** (30 min)
Verify Outscraper returns email for electricians/roofers (not just plumbers/HVAC).
If not, may need to add Google Maps enrichment or accept that email is rare for trade contractors.

Files: `scripts/scout.js`

**Task 1.3 — Pitcher: log email channel sends to cost-log** (30 min)
Email via Zoho is a flat subscription — no per-send cost. Just track send counts.
Add `recordEmail(1)` to cost-tracker.js so the reporter can show email volume.

Files: `scripts/pitcher.js`, `scripts/cost-tracker.js`

**Task 1.4 — Email deliverability verification** (30 min) ⚠️
Before sending cold email at volume, verify trevoadvisors.com DNS has:
- **SPF record** — authorizes Zoho to send for your domain
- **DKIM** — cryptographic signature; configure in Zoho Mail → Settings → Domains
- **DMARC** — start with `p=none` to monitor without blocking
Without SPF/DKIM, cold email from a new domain hits spam ~80% of the time.
Check: mxtoolbox.com/spf and mxtoolbox.com/dkim
Setup: mail.zoho.com → Settings → Domains → verify → add DNS records shown

**Task 1.5 — Test run** (30 min)
Scout Denver plumbers → diagnoser → checker → pitcher dry-run → confirm email routing works.

---

## Phase 2 — Report Enhancement
**Estimated time: 1.5 hours**

### Task 2.1 — Channel breakdown in report (1 hr)
Current: "SMS sent: 18"
New format:
```
OUTREACH — MONTH TO DATE
──────────────────────────────────
  Email sent:      0    (via Zoho SMTP)
  SMS sent:        18   (via Twilio)
  Total:           18
  Daily limit:     30
```

Also add to YESTERDAY section:
- Emails sent yesterday
- SMS sent yesterday
- Any replies (by channel)

Files: `scripts/reporter.js`, `config/pitcher-config.json` (add email_sent_today/month counters)

### Task 2.2 — Track email sends in pitcher config (30 min)
Add `email_sent_today`, `email_sent_this_month` counters to pitcher-config.json.
Mirror the existing `sent_today` / `sent_this_month` (which are SMS-only right now).

Files: `scripts/pitcher.js`, `config/pitcher-config.json`

---

## Phase 3 — Drip Campaign
**Estimated time: 6–8 hours**
*Requires Dave to provide copy before implementation starts.*

### Overview
Non-responders get 2 follow-up touches on a configurable schedule:
```
Initial send (Day 0)
  → No reply after N days → Drip Step 1
  → No reply after M more days → Drip Step 2
  → No reply after P more days → Mark dead
```

### Task 3.1 — Drip config file (30 min)
New file: `config/drip-config.json`
```json
{
  "enabled": true,
  "auto_run": false,
  "step1_delay_days": 4,
  "step2_delay_days": 7,
  "dead_after_days": 14,
  "daily_limit": 20
}
```

### Task 3.2 — Drip templates (30 min to wire up — Dave writes copy)
Add drip templates to `config/templates.json`:
- `d1-sms` — SMS follow-up step 1 (Dave writes)
- `d2-sms` — SMS follow-up step 2 (Dave writes)
- `d1-email` — Email follow-up step 1 (Dave writes)
- `d2-email` — Email follow-up step 2 (Dave writes)

Templates support same placeholders as main templates: [Business Name], [City], [trade], etc.

### Task 3.3 — State machine update (30 min)
Add drip states to the lead lifecycle:
```
sent → drip_1_pending → drip_1_sent → drip_2_pending → drip_2_sent → unresponsive
```

Each messages/-sent.json will track:
```json
{
  "drip_step": 0,
  "drip_1_sent_at": null,
  "drip_2_sent_at": null
}
```

Files: `state.json` schema, `scripts/pitcher.js` (set drip_step: 0 on initial send)

### Task 3.4 — scripts/drip.js (3–4 hrs)
New script: `node scripts/drip.js --force`

Logic:
1. Scan `messages/*-sent.json` for leads with no reply
2. Calculate days since last contact
3. If days >= step1_delay and drip_step === 0 → queue for step 1
4. If days >= step2_delay and drip_step === 1 → queue for step 2
5. If days >= dead_after_days and drip_step === 2 → mark unresponsive
6. Send via same channel as original (SMS → Twilio, email → Zoho)
7. Apply same stagger as Pitcher
8. Respect daily_limit from drip-config
9. Update messages JSON + state.json after each send
10. Log to logs/ via writeLog

Flags:
- `--dry-run` — preview who would get dripped and what message
- `--force` — required to send live
- `--step 1` — only process step 1 queue (optional override)

### Task 3.5 — Reporter drip section (1 hr)
Add drip stats to morning report:
```
DRIP CAMPAIGN STATUS
──────────────────────────────────
  Drip step 1 pending:   3  (>4 days no reply)
  Drip step 1 sent:      0
  Drip step 2 pending:   0
  Unresponsive (dead):   0
```

Files: `scripts/reporter.js`

### Task 3.6 — Add drip to daily run order (30 min)
Update `run-daily.sh` to include drip step after Mobile:
```bash
node scripts/drip.js --force   # Step 7 — follow up non-responders
```

Update `CLAUDE.md` daily run order.

---

## Summary

| Phase | Tasks | Est. Hours | Prerequisite |
|---|---|---|---|
| Phase 1: Email Outreach | 4 tasks | 2.5 hrs | Confirm channel routing decision |
| Phase 2: Report Enhancement | 2 tasks | 1.5 hrs | Phase 1 complete |
| Phase 3: Drip Campaign | 6 tasks | 6–8 hrs | Dave provides drip copy (4 templates) |
| **Total** | **12 tasks** | **~11 hrs** | |

---

## Decision Needed Before Phase 1 Starts

**Channel routing when a lead has both email and phone:**

| Option | Behavior | Tradeoff |
|---|---|---|
| A — Email first | Send email if available, SMS if not | Email = higher B2B conversion, but fewer leads have email |
| B — SMS first | Send SMS if available, email if not | Reaches more leads, but email warmer for B2B |
| C — Both | Send both channels to same lead | Max exposure, but risks coming across as spam; costs double |

**Recommendation:** Option A (email first) — cold B2B email outperforms SMS when available, and Zoho is already set up. SMS remains the fallback for the majority of trade contractors who don't have email in Outscraper.

---

## Drip Copy Needed (Dave writes)

Before Phase 3 build starts, provide 4 short templates:

1. **d1-sms** — SMS follow-up, ~60 words, 4–7 days after initial text (no response yet)
2. **d2-sms** — Final SMS, ~60 words, 7 days after step 1 (last touch)
3. **d1-email** — Email follow-up, subject + ~100 words, 4–7 days after initial email
4. **d2-email** — Final email, subject + ~100 words, 7 days after step 1

Placeholders available: [Business Name], [First Name], [City], [trade], [Phone]

---

*Ready to build Phases 1 and 2 on your go-ahead. Phase 3 needs drip copy first.*
