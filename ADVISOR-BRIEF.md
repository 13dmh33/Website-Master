# Trevo Advisors — System Overview
**For advisor review · Last updated 2026-06-03**

---

## What This Is

Trevo Advisors is a solo AI-powered agency that sells websites and voice agents to home service contractors (plumbers, electricians, roofers, handymen — HVAC excluded due to owner's conflict of interest). The business model is a $100 one-time build fee (no monthly fee), or $100 build + $65/month for an AI agent bundle (Nora/Atlas/Argus). Target: 47 clients/month.

The system is a fully automated outbound sales pipeline built in Node.js. It finds contractor leads, diagnoses their website gaps, writes personalized outreach messages, sends them via email and SMS, follows up automatically, and handles replies — all with minimal human input. A customer-facing website at trevoadvisors.com handles the inbound side: demos, proposals, and checkout.

**Owner:** dave@trevoadvisors.com · (720) 902-7555
**Repo:** github.com/13dmh33/Website-Master
**Hosting:** Netlify (website), Mac mini (outbound scripts)

---

## Revenue Model

| Product | One-Time | Monthly |
|---|---|---|
| Website only | $100 | none |
| Website + Nora/Atlas/Argus (AI agent) | $100 | $65/mo |

Nora is a 24/7 AI phone agent that answers calls, books appointments, and texts back missed callers. It's the upsell offered 7 days after a website deal closes.

**Target:** 47 clients/month = $4,700/mo build revenue; recurring revenue scales with AI-bundle attach rate

---

## File Structure

```
Website-Master/
├── scripts/           — 16 Node.js agent scripts (the sales pipeline)
├── website/           — Static HTML customer-facing site (deployed to Netlify)
├── config/            — JSON config files for all agents
├── agents/            — Prompt files for AI agents
├── leads/             — Raw leads from Scout (JSON, tracked in git)
├── queue/             — Processed lead briefs ready for outreach
├── messages/          — Outreach log: sent messages + reply status (gitignored)
├── mockups/           — Builder outputs: Lovable URLs + video links
├── logs/              — Daily run logs
├── state.json         — Master lead state tracker
├── CLAUDE.md          — Orchestrator config and session instructions
├── PROJECT-STATUS.md  — Current operational status + action items
├── netlify.toml       — Netlify deploy config + URL redirects
├── package.json       — Node.js dependencies
└── run-daily.sh       — Full daily pipeline script
```

---

## The Sales Pipeline — All 14 Scripts

### 1. Scout (`scripts/scout.js`)
**Purpose:** Finds contractor leads in any US city and trade.
**How:** Calls Outscraper API (Google Maps data). Filters for businesses with 5–300 reviews, 4.0+ rating, sorted by "gap score" (how much their online presence is lacking).
**Output:** JSON files in `/leads/` — business name, address, phone, email, website, reviews, rating.
**Run on:** Mac (Outscraper blocks container IPs)
**Cost:** ~$0.01–0.10/run. Hard cap: $10/month.
**Config:** `config/scout-config.json`

```bash
node scripts/scout.js --city "Denver, CO" --trade plumber --force
```

---

### 2. Diagnoser (`scripts/diagnoser.js`)
**Purpose:** Analyzes each lead and writes a personalized outreach brief.
**How:** Sends lead data to Claude Haiku (Anthropic). Identifies website gaps, picks the best message template, fills in variables, and determines the outreach channel.
**Channel routing:**
- Lead has email + phone → primary: email, secondary: SMS (sent 4h later)
- Lead has email only → email
- Lead has phone only → SMS
**Output:** Brief JSON files in `/queue/` — includes filled message, channel, template used.
**Run in:** Container (Anthropic API allowed)
**Cost:** ~$0.003/lead (prompt caching enabled). Hard cap: $5/month.
**Config:** `config/diagnoser-config.json`

```bash
node scripts/diagnoser.js --force
```

---

### 3. Checker (`scripts/checker.js`)
**Purpose:** Quality gate — ensures every message meets standards before sending.
**How:** Runs 5 automated checks (template fill validity, character limits, personalization quality, tone, accuracy). If any fail, triggers a Claude rewrite loop (up to 3 attempts).
**Fast path:** If template variables are all filled correctly, skips AI and approves instantly (saves cost).
**Output:** Updates brief with `approved: true/false` + checker notes.
**Run in:** Container
**Cost:** ~$0.001/lead when AI is needed. Hard cap: $3/month.
**Config:** `config/checker-config.json`

```bash
node scripts/checker.js --force
```

---

### 4. Builder (`scripts/builder.js`)
**Purpose:** Creates a website mockup for the top 5 priority leads.
**How:** Generates a detailed Lovable.dev prompt customized for the contractor's trade, city, and business name. Operator pastes it into lovable.dev, and the site generates in ~2 minutes.
**Output:** Mockup URL recorded in `/mockups/` and `state.json`.
**Run in:** Container (max 5/day)
**Config:** `config/builder-config.json`

```bash
node scripts/builder.js --force
# Paste generated prompt into lovable.dev
node scripts/builder.js --submit --id [lead_id] --url [lovable_url]
```

---

### 5. Filmer (`scripts/filmer.js`)
**Purpose:** Creates a personalized video walkthrough of each mockup.
**How:** Generates Loom recording instructions (what to say, what to show) and optionally takes a screenshot via ScreenshotOne API.
**Output:** Loom URL recorded in `/mockups/` once submitted.
**Run in:** Container
**Config:** `config/filmer-config.json`

```bash
node scripts/filmer.js --force
# Record Loom walkthrough
node scripts/filmer.js --submit --id [lead_id] --url [loom_url]
```

---

### 6. Pitcher (`scripts/pitcher.js`)
**Purpose:** Sends approved outreach messages via email (Zoho SMTP) and SMS (Twilio).
**How:** Sends email first. For dual-channel leads, queues SMS to send 4 hours later. Staggers sends to avoid spam detection. Respects daily limits.
**Per-channel tracking:** Separate sent/unsent tracking for email vs SMS in `messages/-sent.json`.
**Output:** `messages/[lead_id]-sent.json` with full send log.
**Run on:** Mac (Twilio and Zoho SMTP blocked from container)
**Config:** `config/pitcher-config.json` — `sms_followup_delay_hours: 4`, daily limits

```bash
node scripts/pitcher.js --dry-run   # preview what would send
node scripts/pitcher.js --force     # live send
```

---

### 7. Mobile (`scripts/mobile.js`)
**Purpose:** Handles positive replies — books calls and triggers Nora upsell.
**How:** Monitors `messages/` for replies classified as positive. Drafts a booking response with weekday slot suggestions and the `/start` URL. Auto-sends on weekdays. Schedules Nora pitch for 7 days after a website deal closes.
**Run in:** Container

```bash
node scripts/mobile.js --force
```

---

### 8. Drip (`scripts/drip.js`)
**Purpose:** Automated follow-up sequence for non-responders.
**How:** 4-step sequence (d1, d1b, d1c, d2) sent over 14 days. Each step uses a different template per channel (email or SMS). Respects a daily limit of 20. Tracks which step each lead is on.
**Run on:** Mac (Twilio + Zoho blocked from container)
**Config:** `config/drip-config.json`

```bash
node scripts/drip.js --dry-run --force   # preview
node scripts/drip.js --force              # live sends
```

---

### 9. Reporter (`scripts/reporter.js`)
**Purpose:** Sends a morning summary email to dave@trevoadvisors.com.
**Includes:** Email vs SMS sent (MTD + yesterday), reply stats, drip pipeline status, per-service API costs, any urgent action items.
**Run on:** Mac via cron at 7am daily

```bash
node scripts/reporter.js
```

---

### 10. Reply Classifier (`scripts/reply-classifier.js`)
**Purpose:** Classifies incoming replies by intent — no API cost.
**Categories:** positive / question / objection / negative / stop / auto_reply / neutral
**How:** Keyword matching. Zero AI calls. Instantaneous.
**Used by:** Mobile agent and Poller to route responses correctly.

---

### 11. Dashboard (`scripts/dashboard.js`)
**Purpose:** Terminal view of the full pipeline status.
**Shows:** All leads color-coded by status — queued, sent, drip, replied, closed, dead.
**Run in:** Container

```bash
node scripts/dashboard.js
node scripts/dashboard.js --leads    # focus on lead pipeline
node scripts/dashboard.js --drip     # focus on drip status
```

---

### 12. Webhook (`scripts/webhook.js`)
**Purpose:** Receives inbound Twilio SMS messages in real time.
**How:** HTTP server with HMAC-SHA1 signature validation. Writes incoming SMS to `messages/`. Needs ngrok to expose locally to the internet.
**Run on:** Mac (must be publicly reachable)

```bash
# Terminal 1
node scripts/webhook.js
# Terminal 2
ngrok http 3001
# Paste ngrok URL into Twilio console → Phone Numbers → [number] → Messaging → Webhook
```

---

### 13. Poller (`scripts/poller.js`)
**Purpose:** Polls Zoho email inbox for replies via IMAP.
**How:** Uses imapflow library. Detects auto-replies and real replies. Writes to `messages/`.
**Run on:** Mac (Zoho IMAP blocked from container)
**Requires:** `npm install imapflow` on Mac before first run

```bash
node scripts/poller.js
```

---

### 14. Audit (`scripts/audit.js`)
**Purpose:** Validates the full pipeline configuration before a run.
**Checks:** All required env vars present, API connections working, templates valid, config files sane.

```bash
node scripts/audit.js
```

---

## Template Vault (`config/templates.json`)

11 message templates across two channels:

| ID | Channel | Name | Required Fields |
|---|---|---|---|
| e1 | Email | Cold intro — website gap | Business name, city, trade, website status |
| e2 | Email | Review leverage | Business name, review count |
| e3 | Email | Competitor angle | Business name, city, competitor name |
| e4 | Email | Mobile traffic stat | Business name, trade |
| e5 | Email | No-website cold | Business name, city, trade |
| s1 | SMS | Short intro | Business name, city |
| s2 | SMS | Review count | Business name, review count |
| s3 | SMS | Competitor | Business name, city |
| s4 | SMS | Mobile traffic | Business name |
| s5 | SMS | Website gap | Business name, website |
| s6 | SMS | Catch-all | None (always available as fallback) |

**A/B rotation:** Epsilon-greedy (80% exploit best performer, 20% explore). Minimum 3 sends before a template qualifies for exploitation. Stats tracked in `config/template-stats.json`.

All SMS templates are ≤160 characters (1 segment = $0.0079). All templates open with "Hey," — no first-name substitution.

---

## Website — All Pages (`website/`)

Deployed to trevoadvisors.com via Netlify. Static HTML + inline CSS. No framework.

### Customer-Facing Pages

**`/start/`** — Main marketing page
- Hero with H1, trust signals, two CTAs (→ checkout)
- Stats bar: 60% mobile / $100 flat / 24/7 Nora / 0 contracts
- Interactive demo tabs (Plumbing / Electrical / HVAC / Roofing) with live browser mockup
- 6-feature grid (mobile-first, click-to-call, forms, reviews, SEO, maintenance)
- Two pricing cards: $100 website-only vs $100 + $65/mo with Nora
- Sub-nav linking to all 4 demo sites and the configurator
- Phone: (720) 902-7555

**`/demos/plumbing/`** — Peak Flow Plumbing (Denver, CO)
**`/demos/hvac/`** — Comfort Pro HVAC (Nashville, TN)
**`/demos/electrical/`** — Volt & Wire Electric (Austin, TX)
**`/demos/handyman/`** — Square Deal Handyman (Charlotte, NC)

Each demo site includes:
- Full contractor website layout (hero photo, trust strip, 6 service cards with Unsplash photos, 3 reviews, phone CTA)
- Nora chat widget (fixed bottom-right) — opens panel, accepts messages, auto-replies after 900ms
- noindex/nofollow meta tag (not indexed by search engines)
- Each has its own accent color, dark background, and review cities

**`/preview/`** — Site Configurator
- Left sidebar: trade selector (8 trades), business name, city, phone, color pickers (accent + dark), photo grid with shuffle, file upload slots, notes textarea
- Step progress dots (fill teal as trade → name → city → phone are completed)
- Right panel: live srcdoc iframe preview — updates on "Preview my site →"
- Notes parser: detects keywords in the textarea and auto-adds sections:
  - gallery / before / after → before & after photo grid section
  - financ / payment plan → financing banner (accent color)
  - veteran / military → veteran discount section
  - emergency / 24/7 → red emergency availability bar at top
  - about / team / who we are → About Us section
  - area / service map / suburb → service area section with map placeholder
- Purchase panel: slides up with order summary, plan toggle ($100 website-only vs $100 + $65/mo with Nora), checkout button
- Checkout opens `https://trevoadvisors.com/checkout/` with URL params: biz, city, phone, trade, accent, dark, plan, notes

**`/intake/`** — Client intake form
- Multi-step questionnaire (business info, services, competitors, goals)
- Formspree backend (form ID: xbdbneej) — submissions email to dave@trevoadvisors.com

**`/checkout/`** — Payment page
- Two Stripe payment links (one-time $100 website-only, or $100 + $65/mo with Nora)
- **NOTE: Stripe link IDs are currently placeholders** — must be replaced when Stripe is back up
- File: `website/checkout/index.html` lines 345–347

**`/proposal/`** — Proposal / what's included page
**`/thankyou/`** — Post-payment confirmation + next steps

### Legacy Demo Pages (redirected)
Old URLs are redirected via `netlify.toml`:
- `/demo/` → `/demos/plumbing/`
- `/demo/electrician.html` → `/demos/electrical/`
- `/demo/hvac.html` → `/demos/hvac/`

---

## Configuration Files (`config/`)

| File | Purpose |
|---|---|
| `brand.json` | Brand colors (navy #0A1228, teal #00C8AF), domain, contact |
| `templates.json` | All 11 message templates with fill requirements |
| `template-stats.json` | A/B test stats — sends + replies per template |
| `scout-config.json` | Outscraper API settings, $10/mo cap, auto_run toggle |
| `diagnoser-config.json` | Claude model, prompt settings, $5/mo cap |
| `checker-config.json` | Quality gate thresholds, $3/mo cap |
| `pitcher-config.json` | SMS delay (4h), daily limits, send counters |
| `drip-config.json` | Drip sequence timing, daily limit 20 |
| `builder-config.json` | Lovable daily limit (5/day) |
| `filmer-config.json` | ScreenshotOne toggle |
| `cost-log.json` | Running cost tracker — all API spending centrally logged |

---

## Data Files

**`state.json`**
Master lead tracker. Every lead has a record here with:
- `status` — queued / sent / drip_1_sent / replied / closed / unresponsive / dead
- `channel` — email / sms
- `secondary_channel` — sms (if dual-channel)
- `nora_pitch_due` — date for Nora upsell (set 7 days after website deal closes)
- Full send history, reply timestamps, mockup URLs

**`leads/`**
Raw Outscraper output, one JSON file per Scout run. Example: `denver-co-plumber-2026-06-01.json`. Each contains an array of business objects with name, address, phone, email, website, reviews, rating, gap_score.

**`queue/`**
One JSON brief per lead after Diagnoser runs. Contains filled message template, channel, score, checker status. Tracked in git so Pitcher can run on Mac after Diagnoser runs in container.

**`messages/`** (gitignored)
One JSON per lead after Pitcher sends. Contains full send log per channel, reply status, drip step.

---

## Agent Prompts (`agents/`)

Markdown prompt files loaded by each AI-powered script:

| File | Used by |
|---|---|
| `agents/scout.md` | scout.js |
| `agents/diagnoser.md` | diagnoser.js |
| `agents/checker.md` | checker.js |
| `agents/builder.md` | builder.js |
| `agents/filmer.md` | filmer.js |
| `agents/pitcher.md` | pitcher.js |
| `agents/mobile.md` | mobile.js |

---

## External Services & APIs

| Service | Purpose | Monthly Cost | Notes |
|---|---|---|---|
| Anthropic (Claude Haiku) | Diagnoser + Checker AI | ~$0.02 | Prompt caching enabled; hard caps in config |
| Outscraper | Lead scraping (Google Maps) | ~$0.10 | Hard cap $10/mo |
| Twilio | SMS sending + inbound webhook | ~$0.008/msg | A2P 10DLC registration pending |
| Zoho Mail | Email sending + IMAP polling | $0 (subscription) | SPF/DKIM/DMARC configured |
| Netlify | Website hosting | $0 (free tier) | Publishes `website/` directory |
| Stripe | Payment processing | Standard fees | **Links are placeholders — not yet wired** |
| Formspree | Intake form backend | $0 (free tier) | Form ID: xbdbneej — live |
| Lovable.dev | Website mockup generation | Per-use | Builder generates prompts; operator pastes manually |
| ScreenshotOne | Mobile mockup screenshots | Per-use | Optional, toggled in filmer-config.json |
| Cal.com | Booking links for mobile replies | Free tier | `CALCOM_LINK` env var — not yet configured |

---

## Environment Variables

Set in `.env.local` on Mac (never committed to git):

```env
OUTSCRAPER_API_KEY=          # Lead scraping
ANTHROPIC_API_KEY=           # Diagnoser + Checker
ZOHO_EMAIL=                  # dave@trevoadvisors.com
ZOHO_APP_PASSWORD=           # Zoho app-specific password
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=           # +1 720 number
TWILIO_WEBHOOK_SECRET=       # same as TWILIO_AUTH_TOKEN
REPORT_TO_EMAIL=             # 13dmh33@gmail.com
CONTRACTOR_EMAIL=            # optional — deal/reply notifications
CALCOM_LINK=                 # optional — booking URL in Mobile replies
SITE_START_URL=              # https://trevoadvisors.com/start/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Pipeline scripts | Node.js 18+ (ESM, async/await) |
| AI | Anthropic Claude Haiku (claude-haiku-4-5) via `@anthropic-ai/sdk` |
| SMS | Twilio REST API |
| Email sending | Nodemailer via Zoho SMTP |
| Email polling | imapflow (IMAP) |
| Website | Static HTML + inline CSS (no framework, no build step) |
| Hosting | Netlify (free tier, auto-deploy from main branch) |
| DNS | OpenSRS |
| Payments | Stripe payment links |
| Version control | Git / GitHub (`13dmh33/Website-Master`) |

---

## Infrastructure & Deployment

**Remote container (claude.ai/code):**
Runs: diagnoser.js, checker.js, builder.js, filmer.js, mobile.js, dashboard.js, reply-classifier.js
Cannot run: anything requiring Twilio, Zoho SMTP, or Outscraper (all block container IPs)

**Mac mini (local):**
Runs: scout.js, pitcher.js, drip.js, reporter.js, webhook.js, poller.js
Has: `.env.local`, GitHub PAT, cron at 7am for reporter.js, imapflow installed

**Workflow after Mac runs:**
```bash
git add queue/ state.json config/
git commit -m "..."
git push origin main
# Then continue AI steps from container
```

**Website deploy:**
Push to main → Netlify auto-deploys `website/` → live at trevoadvisors.com within ~60 seconds

---

## A2P 10DLC Status (Twilio SMS Compliance)

US carriers require business registration for bulk SMS. Status as of 2026-06-03:

- EIN: Obtained (IRS CP575G, filed under David M Hettinger)
- Brand registration: Submitted under "David M Hettinger" (DBA: Trevo Advisors)
- Bundle SID: `BUb725ec9662f0dc3da58ed24117df8684`
- Status: Pending approval (initial submission rejected due to name mismatch; resubmitted 2026-06-03)
- **Impact:** SMS sends return error 30034 and are blocked by carriers until approved
- Next step after approval: Create Campaign (use case: Mixed) → link the +1 720 number to Sender Pool

---

## Open Action Items (Prioritized)

### Blockers (cannot fully operate without these)

1. **Stripe payment links** — Stripe is currently down. When restored:
   - Go to dashboard.stripe.com/payment-links
   - Create "$100 — Website Build" and "$100 + $65/mo — Website + Nora" links
   - Paste IDs into `website/checkout/index.html` at lines 345–347 (replace `YOUR_WEBSITE_LINK_ID` and `YOUR_NORA_LINK_ID`)
   - Commit and push → Netlify deploys automatically

2. **Twilio A2P 10DLC approval** — Awaiting carrier. No action needed; monitor Twilio console. Until approved, SMS sends fail with error 30034.

### High Priority

3. **Wire inbound SMS webhook** (Mac):
   ```bash
   node scripts/webhook.js        # starts on port 3001
   ngrok http 3001                # expose to internet
   # Paste HTTPS ngrok URL into Twilio console
   ```

4. **Run drip campaign** (due June 5 — day 4 from initial sends):
   ```bash
   node scripts/drip.js --dry-run --force  # preview first
   node scripts/drip.js --force             # send
   ```

5. **Record first Loom mockup video** — this is the main differentiator in the pitch sequence. Run `node scripts/filmer.js --force` for recording instructions.

### Medium Priority

6. Add `CALCOM_LINK` and `SITE_START_URL` to `.env.local` on Mac
7. `npm install imapflow` on Mac (needed for email reply poller)
8. Scout next lead batch — new city or trade
9. Retry D&J Enterprises failed SMS

### Low Priority

10. Tighten DMARC from `p=none` to `p=quarantine` after 30 days of monitoring (due ~July 1)
11. Consider SQLite migration for state.json when lead volume exceeds ~1,000

---

## Suggested Next Steps for Advisor

**If technical advisor:**
- Review `scripts/diagnoser.js` and `scripts/checker.js` for AI prompt quality
- Review `config/templates.json` for message copy — A/B test data will show which perform
- Consider adding a CRM integration (Pipedrive, Airtable) to replace `state.json` as volume grows
- Evaluate moving from Lovable.dev (manual) to a headless website generator for Builder

**If business advisor:**
- The pipeline is fully operational except SMS being blocked pending A2P approval
- First revenue opportunity: focus on closing the leads currently in the `sent` state
- Website is live at trevoadvisors.com — demos at /demos/plumbing, /demos/hvac, /demos/electrical, /demos/handyman
- The /preview configurator lets prospects build their own preview before paying
- Pricing is $100 one-time, no monthly fee — upsell to Nora ($100 + $65/mo) after close
- No employees, no recurring payroll — all AI and automation

**If investor/operator:**
- Monthly run cost at 47 clients: ~$50–80 (APIs + Twilio + Zoho + Netlify)
- Monthly revenue at 47 clients: ~$3,055 (47 × $65/mo hosting) + $7,050 (if all Nora) = potential $10k+/mo
- Current constraint: A2P approval for SMS, and getting first paying client
- System is ready to scale — adding cities and trades is a one-line Scout command
