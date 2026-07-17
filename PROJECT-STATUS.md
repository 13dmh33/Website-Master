# Trevo Advisors — Project Status

**Last updated:** 2026-07-17
**Branch:** `main` — all branches merged and live

---

## Live & Working

| Component | Status | Notes |
|---|---|---|
| scout.js | Live | Mac only — Outscraper API blocked from container |
| diagnoser.js | Live | Container — dual-channel routing (email + SMS) |
| checker.js | Live | Container — 5-eval quality gate + Claude rewrite loop |
| pitcher.js | Live | Mac only — email first, SMS follow-up 4h later |
| builder.js | Live | Container — Lovable prompt generator |
| filmer.js | Live | Container — Loom instructions + ScreenshotOne |
| mobile.js | Live | Container — positive reply handler, booking, Nora upsell |
| reporter.js | Live | Mac/cron 7am — morning email with email/SMS split + costs |
| drip.js | Live | Mac only — 4-step follow-up (d1/d1b/d1c/d2), daily limit 20 |
| reply-classifier.js | Live | Container — keyword intent, zero API cost |
| dashboard.js | Live | Container — terminal pipeline view |
| webhook.js | Live | Mac only — Twilio inbound SMS, HMAC-SHA1 (needs ngrok) |
| poller.js | ⚠️ Superseded | Mac only — IMAP email reply poller; replaced by reply-agent.js (don't cron both) |
| reply-agent.js | Live (on main) | Mac only — inbound Zoho reply → GAP-selling Haiku draft into Zoho Drafts, review-first, $1/mo cap; needs `npm install imapflow mailparser` |
| website/ | **Deployed** | Merged to main 2026-06-03 — Netlify auto-deploy in progress |

## Website Pages (trevoadvisors.com)

| URL | File | Status |
|---|---|---|
| /start/ | website/start/ | Live — redesigned with navy/teal brand |
| /demos/plumbing/ | website/demos/plumbing/ | Live — Peak Flow Plumbing, **real Nora widget** |
| /demos/hvac/ | website/demos/hvac/ | Live — Comfort Pro HVAC, **real Nora widget** |
| /demos/electrical/ | website/demos/electrical/ | Live — Volt & Wire Electric, **real Nora widget** |
| /demos/handyman/ | website/demos/handyman/ | Live — Square Deal Handyman, **real Nora widget** |
| /preview/ | website/preview/ | Live — configurator, **Nora injected into srcdoc** |
| /intake/ | website/intake/ | Live — Formspree form (xbdbneej) |
| /proposal/ | website/proposal/ | Live |
| /checkout/ | website/checkout/ | Live — **Stripe links are PLACEHOLDERS** (see action items) |
| /thankyou/ | website/thankyou/ | Live |

---

## Current Numbers (June 2026)

| Metric | Value |
|---|---|
| SMS sent (MTD) | 48 (18 Denver electricians + 30 Denver/Englewood plumbers) |
| Email sent (MTD) | 15 (Denver plumbers — 2026-06-01) |
| Replies received | Monitoring via webhook + poller |
| Deals closed | 0 |
| MTD cost | ~$0.50 (Twilio + Outscraper + Anthropic) |

---

## Completed Milestones

- [x] All 14 scripts built and live
- [x] Template vault: 6 SMS + 5 email templates, A/B rotation (epsilon-greedy)
- [x] Dual-channel routing — email first, SMS fallback
- [x] Email deliverability — SPF + DKIM + DMARC on trevoadvisors.com
- [x] Morning report cron — 7am daily on Mac
- [x] GitHub PAT — push without prompts
- [x] First real sends — 48 SMS, 15 emails MTD
- [x] Drip campaign live — 4-step sequence
- [x] Reply classifier, dashboard, webhook, poller all merged
- [x] Twilio A2P 10DLC brand submitted (pending carrier approval)
- [x] EIN obtained (David M Hettinger)
- [x] Website redesigned + deployed — navy/teal brand, 4 demo sites, configurator
- [x] netlify.toml — old /demo/* URLs redirected to new /demos/* paths
- [x] brand.json updated to new navy/teal palette
- [x] scout.js — filters leads without website + requires email (email trades) or phone (SMS trades)
- [x] Nora-Agent refactored — 5-trade config system, widget.js rewritten, CORS added
- [x] Demo sites — real Nora widget embedded (nora-agent-lemon.vercel.app), fake scripted widget removed
- [x] Configurator — Nora injected into srcdoc preview, updates with trade + business name

---

## Open Action Items

| Priority | Item | What to do |
|---|---|---|
| 🔴 HIGH | **Wire Stripe Payment Links** | Stripe is currently down. When back up: create 2 payment links at dashboard.stripe.com/payment-links ($150 website, $200 Nora bundle) → paste into `website/checkout/index.html` lines 345–347 replacing `YOUR_WEBSITE_LINK_ID` and `YOUR_NORA_LINK_ID` |
| 🔴 HIGH | Twilio A2P 10DLC approval | Awaiting carrier approval (Bundle SID: BUb725ec9662f0dc3da58ed24117df8684). SMS sends hit error 30034 until approved. Monitor Twilio console. |
| 🔴 HIGH | **Finish Nora-Agent push** | Commit 3bb0755 is ready locally at ~/Nora-Agent. Terminal stopped at GitHub credentials prompt. Run: `cd ~/Nora-Agent && git push origin main` then enter username `13dmh33` and a GitHub PAT (repo scope) as the password. Vercel auto-deploys in ~60s. |
| 🔴 HIGH | Set Nora-Agent env vars on Vercel | Add `CONTRACTOR_TRADE` + `CONTRACTOR_BUSINESS_NAME` per deployment in Vercel dashboard (vercel.com → Nora-Agent → Settings → Environment Variables) |
| 🔴 HIGH | Wire Twilio inbound webhook | Mac: `node scripts/webhook.js` + ngrok + paste public URL in Twilio console → Phone Numbers → your number → Messaging → Webhook URL |
| 🔴 HIGH | Run drip campaign (due Jun 5) | Mac: `node scripts/drip.js --dry-run --force` preview → `node scripts/drip.js --force` |
| 🟡 MED | Record first Loom walkthrough | `node scripts/filmer.js --force`, record screen, submit URL |
| 🟡 MED | Add CALCOM_LINK to .env.local | `CALCOM_LINK=https://cal.com/your-link` |
| 🟡 MED | Add SITE_START_URL to .env.local | `SITE_START_URL=https://trevoadvisors.com/start/` |
| 🟡 MED | Scout second batch | Mac: `node scripts/scout.js --city "..." --trade ... --force` |
| 🟡 MED | Retry D&J Enterprises SMS | Mac: `git pull && node scripts/pitcher.js --force` |
| 🟡 MED | `npm install imapflow` on Mac | Required before poller.js runs |
| 🟢 LOW | Tighten DMARC | After 30 days monitoring: OpenSRS DNS → change `p=none` to `p=quarantine` |
| 🟢 LOW | Tighten DMARC | After 30 days monitoring: OpenSRS DNS → change `p=none` to `p=quarantine` |

---

## Daily Workflow (Short Version)

```bash
# MAC — Scout new leads
node scripts/scout.js --city "..." --trade ... --force
git add leads/ state.json config/cost-log.json && git commit && git push

# CONTAINER — AI processing
node scripts/diagnoser.js --force
node scripts/checker.js --force
node scripts/builder.js --force
node scripts/filmer.js --force

# MAC — Send outreach
git pull && node scripts/pitcher.js --force
# ~4h later (SMS follow-ups to dual-channel leads)
node scripts/pitcher.js --force

# MAC — Daily drip
node scripts/drip.js --force

git add state.json config/ && git commit && git push

# MORNING — cron at 7am
node scripts/reporter.js
```

---

## Cost Summary (June 2026 MTD)

| Service | Spent | Cap |
|---|---|---|
| Anthropic API | ~$0.02 | $8/mo |
| Twilio SMS | ~$0.38 | none (~$0.0079/msg) |
| Outscraper | ~$0.10 | $10/mo |
| Zoho Email | $0.00 | flat subscription |
| **Total** | **~$0.50** | |
