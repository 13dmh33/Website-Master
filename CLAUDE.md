# Website-Master — Project Overview

This repo contains five product systems. Trevo is the main system (root directory). Milly, Miley, Reeve, and Strategy are in subdirectories with their own CLAUDE.md files.

---

## Trevo Advisors — AI agency for home service contractors

**Owner:** Dave — dave@trevoadvisors.com

Brand colors: Navy #0A1228 (background) · Teal #00C8AF (primary accent) · Deep Teal #008870 (logo iris) · White #FFFFFF · Muted #8BA8C4 · Border rgba(255,255,255,0.08)

Your goal: 47 clients/month at $100/site one-time (no monthly fee); AI bundles (Nora/Atlas/Argus) are $100 build + $65/mo. Three AI products, one price point.

**Trade focus: Plumbing (40%) · Electrical (35%) · Handyman (25%) · Roofing (secondary)**
**HVAC is excluded** — owner works for an HVAC manufacturer (conflict of interest). Never scout, pitch, or generate content targeting HVAC contractors.

## Build Status (as of 2026-06-30)
- Scout v2: ✅ scripts/scout.js — --budget/--target/--min-score/--dry-run/--csv/--suggest flags; pre-dedup; social-only detection; qualify_rate; ROI estimate; **HVAC blocked**; **on main (merged)**
- Market Audit: ✅ scripts/market-audit.js — 65 US metros scored; --trade/--top/--csv; zero API cost; **on main (merged)**
- Enricher: ✅ scripts/enricher.js — Apollo.io People Match, 200 credit/mo cap; finds owner email; upgrades sms→email. **Known gap (2026-06-29): no hit/miss stats persisted; Scout/Outscraper returns email empty ~95% of the time, so Enricher is the only systematic email source and its match rate is currently unmeasured.**
- Contact Scraper: ✅ scripts/contact-scraper.js — zero-API email discovery from has-website leads; additive state.json writes; resets to 'scouted' for re-diagnosis; **merged to main (base + `--deep`, confirmed 2026-07-17)**. **`--deep` (2026-07-10):** opt-in deep crawl (up to 3 contact/about/team/staff/meet/our-story pages, robots-aware, ~1 req/sec, 10s timeout) that also fills empty `phone`, `contact_name`, and `socials` fields additively and syncs them to the Google Sheet AllContacts tab (via new shared `scripts/lib/google-sheets.js`, factored out of sheet-log.js). Default (no-flag) behaviour is byte-for-byte unchanged; re-diagnosis still triggers on a new email only.
- Diagnoser: ✅ scripts/diagnoser.js — Claude Haiku, prompt caching, $5/mo cap; dual-channel routing
- Checker: ✅ scripts/checker.js — 5 evals + Claude rewrite loop, $3/mo cap
- Personalizer: ✅ scripts/personalizer.js — generates demo_url per approved lead; now includes star rating (s=) and hero_angle (h=) params for richer /for/ page personalization; --write to save
- Pitcher: ✅ scripts/pitcher.js — dual-channel (email first, SMS +4h); --dry-run; P.S. now names the business: "Here's a live demo of what [BizName]'s site could look like"
- Builder: ✅ scripts/builder.js — Lovable prompt generator, --submit, 5/day
- Filmer: ✅ scripts/filmer.js — Loom instructions + ScreenshotOne, --submit, 5/day
- Mobile: ✅ scripts/mobile.js — positive reply handler; slot suggestions; Nora upsell; sends /start link
- Reporter: ✅ scripts/reporter.js — morning email report; email/SMS split; per-service costs; drip stats
- Drip: ✅ scripts/drip.js — 4-step follow-up (d1/d1b/d1c/d2), per-channel, daily limit 20
- Reply Classifier: ✅ scripts/reply-classifier.js — keyword intent classifier, zero API cost
- Dashboard: ✅ scripts/dashboard.js — terminal pipeline view, --leads/--drip, color-coded
- Webhook: ✅ scripts/webhook.js — Twilio inbound SMS, HMAC-SHA1; **Mac only**
- Poller: ⚠️ scripts/poller.js — IMAP email reply poller (imapflow); **Mac only**; **SUPERSEDED by Reply Agent** (don't cron both on the same inbox)
- Reply Agent: ✅ scripts/reply-agent.js (branch `claude/email-agent-scope-audit-ku4pkc`, not merged) — reads inbound Zoho replies from **known leads only**, strips quoted history/signature (plain + HTML-only fallback), guardrails opt-outs/OOO via reply-classifier (no draft; marks unsubscribed), drafts a **GAP-selling** reply with **Claude Haiku** (fed the diagnosis/review data + original pitch → names the current-state gap, ties to impact, advances with one question/CTA), and **appends a threaded draft to the Zoho Drafts folder** for human review — **nothing auto-sent**. Marks leads `reply_drafted` (not `positive`) so mobile.js never also canned-auto-replies, and writes a `campaign` exit block that halts drip/pitcher (see campaign-exit below). Absorbs poller's IMAP/dedup/OOO/lead-match (Option A). Efficiency: two-phase fetch (envelope scan → source only for known-lead replies) + UID high-water-mark (`last_uid`), batched state writes; auto-detects the special-use `\Drafts` folder and fails fast before spending if none found; RFC-2047-encoded subjects. $1/mo Haiku cap (`config/reply-agent-config.json`); full signature block; **Mac only** (Zoho IMAP), cron 4×/day. Requires `npm install imapflow mailparser`. 21 helper unit tests passing (`scripts/reply-agent.test.js`).
- Caller: ✅ scripts/caller.js — cold call sheet, ranked by gap score; --sms mode for iPhone
- GBP Audit: ✅ scripts/gbp-audit.js — per-lead outreach hooks; CSV
- Warm Lead: ✅ scripts/warm-lead.js — instant follow-up after cold call; text + email + D+2
- LinkedIn: ✅ scripts/linkedin.js — connection request + DM generator; CSV
- Referral: ✅ scripts/referral.js — partner outreach (realtors/inspectors/PMs); LinkedIn + email
- Brief: ✅ scripts/brief.js — daily morning briefing; pipeline stats; prioritized action list
- Website/Demo: ✅ website/ — demos (plumbing/electrical/handyman/roofing/hvac), proposal, intake, checkout, /start, /atlas, /argus; **on main (merged)**
- /for/ demo page: ✅ website/for/index.html — personalization upgraded 2026-06-30: uses s= (star rating), h= (hero_angle insight callout), city-aware compare section, params pass through to checkout; pricing bug fixed ($65/mo removed from website-only hero strip)
- Configurator v2: ✅ website/preview/index.html — 4-step flow, font picker, 6 color presets, 8 toggles, AI Enhance; **on main (merged)**
- Netlify Enhance Fn: ✅ netlify/functions/enhance.js — POST → Claude Haiku; **on main (merged)**
- Molly: ✅ molly/ — Instagram/LinkedIn content engine for Trevo; **on main (merged)**
- Miley: ✅ miley/ — Instagram content engine for Techs4Tatas; **on main (merged)**; see Miley section below
- Atlas: ✅ website/atlas/index.html — AI lead follow-up product; $100 + $65/mo
- Argus: ✅ website/argus/index.html — AI review responder product; $100 + $65/mo

---

## Milly — Instagram content engine for Reeve

**Directory:** `/milly`
**See:** `milly/CLAUDE.md` for full detail

Posts 4x/week to @reeve.agency. Feeds the Reeve client acquisition flywheel.
Weekly pipeline: Researcher → Generator → Designer → Scheduler (Mon–Tue cron via GitHub Actions)

**Status:** Fully built. GitHub Actions active on main. Pending: Buffer classic token + Buffer profile ID.

---

## Miley — Instagram content engine for Techs4Tatas

**Directory:** `/miley`
**See:** `miley/CLAUDE.md` for full detail, `miley/docs/roadmap-specs.md` for the content-quality build backlog

Sibling of Milly/Molly — same pipeline architecture (Researcher → Generator → Designer →
Scheduler → Analyst), different brand brain. Posts to @techs4tatas — apparel celebrating
women in the trades, 30% of profit funds breast cancer research. Brand voice: "Riley Brooks"
(anonymous, no face reveals). Review-first (`FORCE_QUEUE=1`) — nothing auto-posts.

Sales funnel built in: trackable link-in-bio hub (UTM-tagged), "DM PINK" autoresponder,
click attribution loop feeding the Analyst.

**Status:** Fully built and merged to `main`. Verified end-to-end (2026-06-22): full pipeline
dry-run clean, evergreen fallback works with zero API key, linkpage builder + DM responder
tested, breast-cancer stats re-verified current for 2026 (no changes needed). Real Bebas Neue
+ Inter brand fonts added to `assets/fonts/` (auto-detected by `lib/canvas-render.js`) —
cards now render in real brand fonts instead of the DejaVu fallback.

**Reels engine (2026-07-08, branch `claude/tatas-reels-tech-gv5khk`, not merged):** Miley now turns a script into a finished vertical 1080×1920 `.mp4` — the actual postable Reel. Two visual styles (`card` beat-cards, and `kinetic` word-by-word typography with `karaoke`/`punch` sub-modes) plus a content-theme rotation (motivational / mission / product) both rotate weekly and independently. $0 marginal cost (skia-canvas + bundled static ffmpeg; silent; review-first). Full detail + example scripts: `miley/docs/reels.md`; partner overview: `miley/docs/reels-overview.html`.

Pending (all Mac/account-side, can't be done from container):
- Printify catalog scrape (`scripts/scrape-catalog.js`) — `techs4tatas.printify.me` returns
  403 to all fetch paths (anti-bot, not just container egress) — run on Mac or paste a
  product list manually.
- Real Canva brand-kit hex colors → `miley/templates/visual-config.json` (currently a
  placeholder palette, flagged `ACTION_NEEDED`).
- Product mockup PNGs → `miley/assets/products/`.
- Buffer classic token + Instagram Business IDs + GA4/Pixel + Formspree + ManyChat wiring.

---

## Reeve — Speaker booking DM agent and outreach system

**Directory:** `/reeve`
**See:** `reeve/CLAUDE.md` for full scope and roadmap

DM qualification agent + full outreach pipeline. When speaker DMs "stages" → 3-question qualification → 4-tier scoring → routes to Dave or declines. Phases 2–6: conference scout, pitcher, follower, reporter, closer.

**Status:** All 6 phases built. Pending: Meta App setup + Railway deploy + Cal.com link.

---

## Strategy — Business intelligence and pricing monitor

**Directory:** `/strategy`
**See:** `strategy/CLAUDE.md` for monitoring cadence and metric thresholds

Zero-API-cost monitoring agent. Reads pipeline JSON files, computes MRR/conversion/churn metrics, flags alerts, produces pricing analysis. Run weekly (Mondays).

**Scripts:**
- `node strategy/agents/strategist.js --dashboard` — terminal health view (default)
- `node strategy/agents/strategist.js --monitor` — dashboard + save JSON snapshot to strategy/reports/
- `node strategy/agents/strategist.js --pricing` — full pricing model analysis
- `node strategy/agents/strategist.js --alerts` — active alerts only

---

## Template Vault
- 8 SMS templates (s1–s8) + 7 email templates (e1–e7) in config/templates.json
- s7 = Atlas AI angle; s8 = Argus review hook
- e6 = Atlas pitch; e7 = Argus pitch (requires review_count)
- s6 = catch-all (no data requirements) — always available as fallback
- All SMS templates ≤160 chars (1 segment = $0.0079/msg, not $0.04)
- Templates open with "Hey," — no [First Name] substitution
- Diagnoser picks and fills the best template for each lead (no AI-generated copy)
- Templates with missing required fields are skipped automatically (canFill check)
- A/B rotation: epsilon-greedy (20% explore / 80% exploit), MIN_SENDS=3 bootstrap
- Stats tracked in config/template-stats.json (sent + replies per template)
- scripts/template-picker.js handles selection, fill, and stats recording

## File System
- /leads/       — raw leads from Scout (JSON files per city+date)
- /queue/        — leads ready for processing (briefs from Diagnoser); tracked in git
- /mockups/      — Builder outputs (Lovable URLs + video links)
- /messages/     — Pitcher outreach log (sent messages + reply status); gitignored
- /logs/         — daily run logs
- /config/       — agent config files (budget caps, toggles, templates, cost log)
- /scripts/      — runnable Node.js scripts for each agent

## Sub-Agents
Load prompts from /agents/ folder:
- agents/scout.md
- agents/diagnoser.md
- agents/builder.md
- agents/filmer.md
- agents/checker.md
- agents/pitcher.md
- agents/mobile.md

## Orchestration Rules
- Never assign 2 agents to the same lead simultaneously
- Write lead state to state.json after every step
- Human approval required for: deals over $3,000, reply rate below 12%
- Only Builder gets top 5 priority leads per day — not all leads
- Pitcher sends ONLY after Checker has approved the message
- After website deal closes: flag lead for Nora pitch in 7 days
- Scout runs in manual mode (auto_run: false) during testing — use --force flag
- Scout works for any city and any supported trade — no city is hardcoded as default

## Daily Run Order
Shortcut: `./run-daily.sh` (or `npm run daily`) runs all steps in order with manual-step pauses.

Manual order:
1. Scout → target city + trade (ask human at start of each session) — **run on Mac**
2. Enricher → `node scripts/enricher.js --force` — finds emails for phone-only leads — run in container
3. Diagnoser → process all new leads from /leads/ — run in container
4. Checker + Builder → top 5 priority leads only — run in container
5. Personalizer → `node scripts/personalizer.js --write` — generates demo_url for every approved lead — run in container
6. Filmer → mockups from Builder — run in container
7. Pitcher → approved messages only — **run on Mac** (Twilio blocked from container)
8. Mobile → monitor /messages/ for positive replies — run in container
9. Drip → follow-up non-responders — **run on Mac** (Twilio + Zoho SMTP blocked from container)
10. Reporter → `node scripts/reporter.js` on Mac each morning (or cron at 7am)

## Nora Upsell
- Website deal closes → set nora_pitch_due = closed_date + 7 days in state.json
- Mobile agent sends Nora pitch message on due date
- Bundle price: $65/mo (website hosting + Nora)
- Build fee with Nora included: $100, same as website-only (no monthly fee on website-only)

## Cost Controls
- Scout: $10/mo Outscraper cap (config/scout-config.json)
- Diagnoser: $5/mo Anthropic cap (config/diagnoser-config.json)
- Checker: $3/mo Anthropic cap (config/checker-config.json)
- Twilio: ~$0.0079/SMS (no cap — tracked in config/cost-log.json)
- All costs centrally logged in config/cost-log.json via scripts/cost-tracker.js

## Environment Variables Needed
```
OUTSCRAPER_API_KEY=
ANTHROPIC_API_KEY=
ZOHO_EMAIL=              # dave@trevoadvisors.com
ZOHO_APP_PASSWORD=       # Zoho app-specific password (not account password)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_PHONE=
TWILIO_WEBHOOK_SECRET=   # same as TWILIO_AUTH_TOKEN — used for HMAC validation in webhook.js
REPORT_TO_EMAIL=         # where morning report is emailed (defaults to ZOHO_EMAIL)
APOLLO_API_KEY=          # enricher.js — Apollo.io Basic plan ($49/mo)
CONTRACTOR_EMAIL=        # optional — deal/reply notifications
CALCOM_LINK=             # optional — shown in Mobile booking drafts
SITE_START_URL=          # https://trevoadvisors.com/start/ — sent in positive reply drafts
```

## Start Each Session
Ask: "What city and trade should Scout target today?"
Scout works for any US city — no defaults. City and trade are always specified at runtime.

## Important: Runs Locally on Mac
The remote Claude Code container has restricted outbound network access.

**Must run on Mac:**
- Scout (scripts/scout.js) — Outscraper API blocks container IPs
- Pitcher (scripts/pitcher.js) — Twilio SMS API blocked from container
- Drip (scripts/drip.js) — Twilio SMS + Zoho SMTP blocked from container
- Reporter (scripts/reporter.js) — Zoho SMTP blocked from container
- Webhook (scripts/webhook.js) — Twilio inbound webhook server, must be publicly reachable (use ngrok)
- Poller (scripts/poller.js) — Zoho IMAP blocked from container

**Runs fine in container:**
- Diagnoser, Checker, Builder, Filmer, Mobile, Dashboard, Reply Classifier (all use Anthropic API or no external API)

Local workflow after Scout/Pitcher runs on Mac:
1. `git add queue/ state.json config/pitcher-config.json config/cost-log.json`
2. `git commit -m "..."` and `git push origin main`
3. Continue AI steps from container

Note: GitHub PAT is configured on Mac (set 2026-06-01). Push works without password prompts.
Morning reporter cron is set on Mac: runs at 7am daily.

## Lead Filter
Scout filters: 5–300 reviews, rating 4.0+, sorted by gap_score desc.
Max reviews raised to 300 to capture qualifying leads in larger cities.

## Channel Routing (Diagnoser)
- Lead has email + phone → channel: email, secondary_channel: sms (SMS follows 4h later)
- Lead has email only → channel: email
- Lead has phone only → channel: sms (or ig_dm/linkedin per Scout trade assignment)
- Delay configurable: config/pitcher-config.json → sms_followup_delay_hours (default: 4)

## Email Deliverability
✅ SPF + DKIM + DMARC all configured on trevoadvisors.com (OpenSRS DNS, 2026-06-01).
Safe to send cold email at volume. DMARC set to p=none (monitor only) — tighten to p=quarantine after first month.

## Live Run History
- 2026-06-01: First real SMS send — 18/19 Denver electricians sent via Twilio template s1
- 2026-06-01: Phase 1+2 complete — dual-channel routing, per-channel counters, report email/SMS split
- 2026-06-01: Email deliverability complete — SPF + DKIM + DMARC set in OpenSRS DNS
- 2026-06-01: GitHub PAT + cron reporter configured on Mac
- 2026-06-01: SMS templates trimmed to ≤160 chars (1 seg); s6 catch-all added; Hey [First Name] removed
- 2026-06-01: First email batch — 15 Denver plumbers sent via Zoho SMTP
- 2026-06-01: Drip campaign live — drip.js built (4-step sequence, 8 templates approved and loaded)
- 2026-06-02: reply-classifier.js, dashboard.js, webhook.js, poller.js merged to main
- 2026-06-02: website/ directory built — 3 demos + proposal + intake + checkout + thankyou + /start funnel
- 2026-06-02: mobile.js updated — sends /start URL in positive reply, Zoho SMTP fix confirmed
- 2026-06-02: Global pricing update — $150/$200 build + $65/mo
- 2026-06-24: Global pricing update — flat $100 build (basic and AI bundles); basic has no monthly fee; AI bundles (Nora/Atlas/Argus) add $65/mo
- 2026-06-03: 30 Denver/Englewood plumbers sent via SMS; 48 total MTD
- 2026-06-03: Diagnoser channel routing bug fixed; webhook/poller crash fixes
- 2026-06-03: EIN obtained; Twilio A2P 10DLC Brand registration submitted
- 2026-06-03: Personalizer built — /for/ demo URL per lead; pitcher uses demo_url P.S.
- 2026-06-04: Scout improved — gap scoring, --multi, HVAC excluded
- 2026-06-05: Enricher, CEO sprint, Scout v2, Configurator v2, Molly, Market Audit
- 2026-06-05: HVAC excluded across all systems
- 2026-06-10: Milly/Reeve/Strategy code added to main — GitHub Actions active for Milly pipeline
- 2026-06-22: Confirmed pending merges (trevo-advisors-review-Sjewy, molly-ui-polish, scout-refinement) already landed on main; handyman demo already exists
- 2026-06-22: Miley verified end-to-end (pipeline dry-run, linkpage, DM responder); real Bebas Neue + Inter fonts added; breast-cancer stats re-verified current
- 2026-06-22: Miley content-quality roadmap specced — see miley/docs/roadmap-specs.md
- 2026-06-23: Miley calendar engine (#10) built — `templates/calendar.json` + `lib/calendar.js` inject date-specific observances (WIC Week, Skilled Trades Day, Mother's Day, National Apprenticeship Week, monthly self-exam reminder) into base/september weeks; October unaffected
- 2026-06-29: Live Scout scraping (both modes) found zero usable email leads — built `scripts/sheet-import.js` as a stopgap importer for manually-curated Google Sheet leads (company/URL/phone/email), same lead contract as Scout. Imported 59 curated plumber/handyman leads; pipeline ran end-to-end (90 briefs checked, 5 real emails sent via Zoho to sheet-import leads). Confirmed: remaining 146 checked leads in queue are 100% SMS-only — Scout/Enricher have not produced any email-capable leads this week. Root-caused why: Outscraper (Scout's data source) doesn't return emails from GMB listings (~95% empty); Apollo.io (Enricher) is capped at 200 credits/mo and depends on phone-match accuracy; no hit/miss stats are persisted from Enricher runs. Manual Sheet curation currently outperforms the automated pipeline for email yield.
- 2026-06-29: Temporarily raised `config/checker-config.json` daily_limit 30→120 (count cap only, monthly $ cap untouched) to clear same-day backlog — needs reverting to 30 once back from travel.
- 2026-06-29: Bumped diagnoser + checker daily_limit to 250 to clear email-lead backlog (53 stuck leads); 79 newly approved, Pitcher sent 25 emails same day (30/day limit). Dollar caps untouched.
- 2026-06-30: Contact-scraper built (feature/contact-page-scraper): free email discovery from lead websites, two bugs found+fixed (domain-match false positive; "none" placeholder strings).
- 2026-06-30: Sheet-log v1 live-tested — SentLog tab created, header written, 5 rows appended, 0 errors.
- 2026-06-30: Sheet-log v2 built (feature/sheet-log-refine): 14-col CRM, update-in-place, drip timestamps, reply/unsubscribe columns, notes preserved, old-format migration handled.
- 2026-06-30: Demo link personalization upgraded — pitcher P.S. names business, personalizer passes s= (rating) + h= (hero_angle), /for/ page shows insight callout + star-rated reviews + city-aware compare + checkout param pass-through; $65/mo pricing bug fixed.
- 2026-07-10: Contact-scraper `--deep` mode built (branch `feat/contact-scraper-deep`, off main, not merged) — opt-in deep crawl + full contact extraction (phone via tel:/US-regex, owner/contact name via role-adjacent patterns with tag-boundary segmentation, socials facebook/instagram/linkedin) across homepage + up to 3 contact/about/team/staff/meet/our-story pages; robots.txt-aware, ~1 req/sec, 10s timeout, realistic UA. All new fields written to EXISTING lead-record fields additively (`phone`; new `contact_name` + `socials` added since they didn't exist), never overwriting; re-diagnosis still triggers on a new email only. Syncs new values to Google Sheet AllContacts (adds a `socials` column, fills empty phone/email/socials cells) via new shared `scripts/lib/google-sheets.js` (Google auth + Sheets v4 client factored out of sheet-log.js, behaviour-preserving). Default (no `--deep`) run is byte-for-byte identical to before (verified by diff vs origin/main). 19 unit tests + 3 localhost-fixture integration scenarios (email-on-subpage flip+requeue, additive preservation, phone/social-only no-requeue) passing.
- 2026-07-10: Contact-scraper `--deep` audit follow-up (same branch) — efficiency + recall upgrades, still default-unchanged/`--deep`-gated. Recall: JSON-LD/schema.org parsing (email/telephone/sameAs/founder), Cloudflare `data-cfemail` decode, `info [at] biz [dot] com` de-obfuscation, alt/title-attr names, contact-link **priority ranking** (fixes bug where `/contact` could be dropped by the page-budget slice), common-path probing (`/contact`,`/about-us`…) when nav is thin, broadened socials (twitter-x/youtube/tiktok/yelp/google/bbb/angi/nextdoor + FB `profile.php?id=` query-preservation fix), and an optional Playwright/Chromium SPA-render fallback (graceful skip if `playwright` not installed). Efficiency: **concurrent** crawling (`--concurrency`, default 6; per-host politeness kept), lazy robots.txt fetch, https-first, early-exit once email+phone+name are in hand, cached leads-file reads, hoisted regexes. New flags `--concurrency N` / `--no-render`. 31 unit tests + multi-site concurrent integration fixture (JSON-LD site, Cloudflare+ranked-link site, probe+deobfuscation site) all passing.
- 2026-07-17: Campaign-exit built + housekeeping — reply-agent.js now flags a `campaign` exit (replied/opted_out) on draft/opt-out; drip.js + pitcher.js suppress exited leads (closes the follow-up-after-reply gap); sheet-log.js reflects `reply_drafted`/exit on the CRM sheet. Reverted diagnoser + checker daily_limit → 30. Confirmed contact-scraper (base + `--deep`) was already merged to main (stale "not merged" notes fixed). 21 reply-agent unit tests passing.
- 2026-07-17: Reply Agent built (merged to main) — `scripts/reply-agent.js` reads inbound Zoho replies from known leads, understands each with Claude Haiku, and writes a threaded, review-first draft into the Zoho Drafts folder (nothing auto-sent). Absorbs/supersedes `poller.js`; reuses `reply-classifier.js` as an opt-out/OOO guardrail (finally wired in). Marks leads `reply_drafted` (not `positive`) so mobile.js won't also canned-auto-reply. $1/mo Haiku cap in `config/reply-agent-config.json`; Mac-only (Zoho IMAP), cron 4×/day; needs `npm install imapflow mailparser`. 9 helper unit tests passing.
- 2026-07-08: Miley Reels engine built (branch `claude/tatas-reels-tech-gv5khk`) — script → finished 1080×1920 `.mp4` via skia-canvas + bundled static ffmpeg (`@ffmpeg-installer/ffmpeg`), $0/video, silent, review-first. `card` style (beat-cards, Ken Burns, beat-synced cuts) + `kinetic` word-by-word typography (`karaoke` progressive reveal + `punch` one-word), rendered via `renderReelWordFrame` with frozen layout; concat-demuxer frame-accurate holds; filmic grade + moving grain. Realism pass: Stories-style progress bar (no carousel counter), `*word*` accent highlight, vignette, safe-zone layout. Weekly rotations (independent): visual style (`reel_styles`) + content theme (`reel_content_rotation`: motivational / mission / product; product reels render over `assets/products/<key>.png`). 29 automated checks passing. Docs: `miley/docs/reels.md` (full examples), `miley/docs/reels-overview.html` (partner page).

## Twilio A2P 10DLC Status
- Brand registration submitted: 2026-06-03
- Bundle SID: BUb725ec9662f0dc3da58ed24117df8684
- Status: Resubmitted 2026-06-03 under "David M Hettinger" (initial rejection: name didn't match EIN)
- Legal name for all Twilio/IRS submissions: David M Hettinger (DBA: Trevo Advisors)
- Once approved: create Campaign (use case: Mixed) → link +1 720 number to Sender Pool
- Until approved: SMS sends will hit error 30034 and be blocked by carriers

## Action Items (as of 2026-06-22)

### Revenue — do on Mac now
1. **Personal SMS** (no Twilio needed): `node scripts/caller.js --sms` → copy-paste to iPhone → 10–15 leads/day
2. **Cold calls**: `node scripts/caller.js` → ranked list with talk tracks + demo URLs → call top 20
3. **GBP hooks**: `node scripts/gbp-audit.js` → per-lead opener lines → use before cold call
4. **LinkedIn**: `node scripts/linkedin.js` → CSV → send 15 connection requests
5. **Referral partners**: `node scripts/referral.js` → 3 realtors/inspectors/PMs = 6–12 passive leads/mo
6. **Next Scout run**: `node scripts/scout.js --suggest plumbing` → pick top market → scrape $0.25

### Setup blockers (Mac)
- [ ] **Twilio A2P**: check status at console.twilio.com — once approved, create Campaign, link +1 720, run pitcher
- [ ] **Stripe**: create payment links ($100 website-only / $100 + $65/mo for Nora / Atlas / Argus bundles) → paste IDs into `website/checkout/index.html`
- [ ] **Formspree**: create form at formspree.io → paste form ID into `website/intake/index.html`
- [ ] **Netlify deploy**: confirm trevoadvisors.com/start/ + /for/ + /atlas/ + /argus/ + /demos/ all live
- [ ] **Webhook**: `node scripts/webhook.js` + ngrok → register URL in Twilio console
- [ ] **Apollo.io**: sign up ($49/mo) → add `APOLLO_API_KEY=` to `.env.local`
- [ ] **Buffer classic token** → add to `milly/.env` (for Milly auto-posting to @reeve.agency)
- [ ] **Reeve**: Meta App setup + Railway deploy + Cal.com link (see `reeve/CLAUDE.md`)
- [ ] **Reeve Scout cron**: add `SERPAPI_KEY` as a GitHub Actions secret so `.github/workflows/reeve-weekly-scout.yml` can run (Monday 6am MT)
- [ ] **Miley catalog**: run `node scripts/scrape-catalog.js --write` on Mac (blocked from container — Printify storefront 403s all server-side fetches), or paste a product list
- [ ] **Miley brand colors**: replace placeholder hex in `miley/templates/visual-config.json` with real Canva brand-kit colors
- [ ] **Miley product photos**: drop Printify mockups into `miley/assets/products/`
- [ ] **Miley Buffer token** → add to `miley/.env` (for auto-posting to @techs4tatas, separate from Milly's)

### Next Claude session — container tasks
- [x] Merge `claude/trevo-advisors-review-Sjewy` → main (already merged as of 2026-06-24 check)
- [x] Merge `claude/molly-ui-polish` → main (already merged as of 2026-06-24 check)
- [x] Merge `claude/scout-refinement` → main (already merged as of 2026-06-24 check)
- [x] Handyman demo site exists at website/demos/handyman/
- [x] 2026-06-24: Removed HVAC from all public-facing pages (/start/, /for/, /proposal/) — HVAC is excluded per conflict-of-interest policy but was still being marketed/linked publicly. website/demos/hvac/ left in place but no longer linked.
- [ ] Check `miley/docs/roadmap-specs.md` for the next batch of specced content-quality build work for Miley when ready to pick one up.
- [x] **Reverted `config/checker-config.json` + `config/diagnoser-config.json` daily_limit → 30** (2026-07-17; monthly $ caps were never touched).
- [x] **Contact-scraper merged to main** (base + `--deep`; confirmed 2026-07-17) — run on Mac after Scout `--mode has-website`.
- [ ] **Regenerate demo URLs for already-sent leads**: run `node scripts/personalizer.js --write --force` on Mac — adds s= (rating) + h= (hero_angle) to the 48+ existing demo links so they get the richer /for/ page.
- [ ] **Persist Enricher hit/miss stats** — `scripts/enricher.js` currently prints found/noMatch/error counts to terminal but never saves them; add a per-run summary to `config/enricher-config.json` so Apollo's real success rate is visible over time instead of guessed.
- [ ] **Check licensed-contractor registries** (state Chamber of Commerce / contractor licensing boards) as a free, ToS-clean public-data email source — untapped, not yet scoped per-state.
- [ ] **Decide on Google Sheet write-back** — user wants to eventually move scraper output + pipeline run logs into the same Sheet used for sheet-import (not just read from it). Needs Google Sheets write API (only read-only Drive access used so far). Not scoped — needs a follow-up conversation on what "logs" should contain before building.
- [x] **Campaign-exit on reply (built 2026-07-17):** when `reply-agent.js` drafts a reply or logs an opt-out it writes a `campaign` exit block (`{status:'exited', reason:'replied'|'opted_out', exit_step, exit_channel, exited_at, by}`) to the sent record + a `campaign_exit` block on the `state.json` queue entry. `drip.js` now suppresses via a `campaignActive(sent)` guard (skips `campaign.status==='exited'` plus `positive`/`unresponsive`/`reply_drafted`/`unsubscribed`) at both the queue-build and unresponsive-sweep points; `pitcher.js` skips exited leads in `loadApprovedBriefs` (closes the dual-channel re-send window); `sheet-log.js` recognizes `reply_drafted` + exit reason so the CRM row flips to replied / do-not-contact and the changelog logs it via the reply/unsub columns. Idempotent (opt-out outranks a prior replied; first timestamp/step preserved). Reflected to the Google Sheet lazily via the next `sheet-log.js` run (Option A). 6 new unit tests (21 total).

### Milly — first run (Mac, after Buffer token setup)
1. Add `BUFFER_ACCESS_TOKEN` + `BUFFER_INSTAGRAM_PROFILE_ID` to `milly/.env`
2. GitHub Actions cron is active on main — Mon 6am MT pipeline, Sun 10pm analytics
3. Manual test: `cd milly && node scripts/test-pipeline.js`

### Miley — first run (Mac, after Buffer token setup)
1. Add `BUFFER_ACCESS_TOKEN` + `BUFFER_INSTAGRAM_PROFILE_ID` to `miley/.env`
2. GitHub Actions cron is active on main — Thu pipeline (generates next week), Sun analytics
3. Manual test: `cd miley && node scripts/test-pipeline.js`
