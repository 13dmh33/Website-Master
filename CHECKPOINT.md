# Checkpoint — autonomous session, June 17-18 2026

Branch: `claude/sweet-lovelace-1xc2jw`. All commits prefixed per role. No live outreach sent. No real money moved. No `state.json` production data touched (worked through `scripts/state-store.js`, only auto-generated `state.backup.json` written, gitignored).

## 1. Completed

**Priority 1 — revenue blockers**
- Cal.com link wired as default/fallback: pitcher.js, drip.js, website/start/index.html, reeve/agents/dm-agent.js
- webhook.js: added `/health` endpoint, confirmed HMAC-SHA1 correct
- SETUP_WEBHOOK.md written
- Stripe: confirmed checkout/index.html structurally complete with placeholder Payment Link constants — cannot create real links (no real money movement rule). Blocker, see below.

**Priority 2 — Nora multi-trade refactor**
- Skipped entirely per explicit decision (no Nora backend/page exists anywhere in repo)

**Priority 3 — Trevo pipeline hardening**
- state.json centralized behind scripts/state-store.js: schema validation, >500-lead warning, auto-backup before every write. Wired into builder/checker/diagnoser/drip/filmer/mobile/pitcher/poller/scout/webhook/audit.
- checker.js: added pre-flight budget-projection throttle (parity with diagnoser.js)
- template-picker.js: added `--report` CLI flag; fixed crash (`TypeError: list is not iterable` on non-array `drip` key in templates.json)
- gbp-audit.js: added `very_low_reviews` (<10) tier, `no_hours`/`no_photos` gap checks (no-ops until Scout collects those fields)

**Priority 4 — Milly activation prep**
- Verified gradient fallback render works in-container (skia-canvas, no Unsplash needed) — confirmed with real PNG output
- scheduler.js: added `--dry-run` flag, verified live
- MILLY_SETUP.md written (Buffer token + profile ID + .env + test steps, <20 min)

**Priority 5 — Reeve infrastructure prep**
- dm-agent.js: added `--simulate` flag, verified full conversation flow end to end (trigger → 3 questions → score → route → notify stub)
- Verified closer.js's `bookings_confirmed` increment shallow-merges via client-store.js `updateClient` — does not overwrite other fields
- REEVE_SETUP.md written (Meta App, Railway, Cal.com, ngrok steps)

**Priority 6 — copy and brand audit**
- "bot"/"chatbot" → "AI agent" fixed (templates.json s7, argus/index.html, molly/generator.js, caller.js) — earlier session
- HVAC: confirmed scout.js is the single hard-block point (rejects at trade-validation gate before any scrape). Fixed 3 stale doc comments that implied active HVAC outreach (scout.js usage examples, market-audit.js usage comment, pitcher.js channel-routing comment). Left trade-label maps (builder/warm-lead/linkedin/checker) and inbound HVAC demo pages alone — unreachable/inert since no HVAC lead is ever produced, not outbound targeting.
- Sentence case: fixed Title Case headings in website/proposal/index.html and website/checkout/index.html (6 + 7 headings/labels)
- Personal names: removed "Dave" from customer-facing marketing copy in checkout/intake/for/proposal pages (replaced with "we"/"us"). Left footer legal attribution ("Trevo Advisors · Dave Hettinger") and dave@trevoadvisors.com contact emails — business/contact info, not persona copy.

**Priority 7 — strategy dashboard accuracy**
- Ran `strategist.js --dashboard` against real data: $0 MRR/ARR confirmed correct (zero Reeve clients onboarded — not a bug)
- ARR formula (`mrr * 12`) was already correct — documented in code comment that it covers Reeve client retainers only, NOT Trevo hosting/Nora (no MRR tracking exists for that — see Nora note below)
- Added `last_updated` timestamp to dashboard output

## 2. Skipped — with reasons

- **Priority 2 (Nora refactor):** no Nora backend/page exists anywhere in repo. User decision: skip entirely rather than build from scratch in this session.
- **Brief's literal Nora ARR formula ($350/mo):** overridden per user decision — Nora is $65/mo bundled (current site pricing), not a separate $350 product. No code uses $350 anywhere; nothing to fix.
- **Emoji removal beyond outreach copy:** brief says "no emojis anywhere" but also narrower wording "emoji characters in outreach copy." 50+ files contain emoji — CLI status characters (✓✗→⚠) and decorative website icons (🤖⭐⚡🛡️🌱🔒📞). Fixed scope: customer-facing outreach copy only (bot fixes above had no emoji). Did not touch CLI output symbols or decorative website icons — high blast radius, low signal, recommend dedicated pass next session if "anywhere" is meant literally.
- **Full repo-wide HVAC removal of trade-label map entries:** builder.js/warm-lead.js/linkedin.js/checker.js have `hvac:` entries in lookup maps. Left as-is — they're unreachable since scout.js blocks HVAC before any lead with `trade: 'hvac'` can exist in state.json. Removing them is cosmetic cleanup, not a safety fix.
- **Lint + full test suite before this checkpoint:** no test suite or lint config found in repo root, milly/, or reeve/ (checked package.json scripts in each — no `test`/`lint` script defined). Verified all touched JS files with `node --check` instead (syntax-valid). Flagging as a gap, not a skip — see blockers below.

## 3. Blockers Dave must resolve — ranked by revenue impact

1. **Stripe Payment Links not created** (blocks all checkout — highest revenue impact)
   - Go to dashboard.stripe.com → Payment Links → create 4: $150 website / $200 Nora bundle / $200 Atlas / $200 Argus
   - Paste resulting URLs into `website/checkout/index.html` (STRIPE_LINK_WEBSITE, STRIPE_LINK_NORA, STRIPE_LINK_ATLAS, STRIPE_LINK_ARGUS constants)
   - Cannot be done by agent — real money movement is hard-blocked by session rules

2. **Twilio A2P 10DLC still pending** (blocks all SMS outreach — error 30034 until approved)
   - Check status at console.twilio.com
   - Once approved: create Campaign (use case: Mixed), link +1 720 number to Sender Pool
   - Until then: use `node scripts/caller.js --sms` (manual copy-paste, no Twilio needed)

3. **Buffer classic token missing** (blocks Milly auto-posting — zero Instagram content going out)
   - buffer.com/developers → Create App → Generate Access Token (classic, NOT the OIDC token from MCP page)
   - `curl https://api.bufferapp.com/1/profiles.json?access_token=TOKEN` → find @reeve.agency entry → copy `id`
   - Add both to `milly/.env`, see MILLY_SETUP.md for full steps (~20 min)

4. **Reeve has zero infrastructure** (blocks all speaker DM qualification — zero Reeve revenue possible)
   - Meta App + Instagram Business connection + Railway deploy + webhook registration
   - Full steps in REEVE_SETUP.md
   - Note: Cal.com link currently shared with Trevo's main booking flow (`cal.com/david-hettinger-g8qbdk/30min`) — confirm this is acceptable for Reeve or create a dedicated link before going live

5. **Apollo.io not signed up** (blocks Enricher — phone-only leads can't get owner emails)
   - Sign up $49/mo → add `APOLLO_API_KEY` to `.env.local`

6. **Formspree form not created** (blocks intake form submission)
   - formspree.io → create form → paste form ID into `website/intake/index.html`

## 4. Recommended next session — top 3

1. **Stripe + Twilio A2P resolution session (Mac-only, ~30 min, highest leverage)** — these two blockers alone unblock checkout payments and SMS outreach, the two highest-revenue-impact gaps. Cannot be done from container.
2. **Reeve activation (Mac + Meta + Railway, ~1-2 hrs)** — Reeve is fully built and tested (`--simulate` confirmed working) but has zero live infrastructure. This is a second, currently-dormant revenue line ($597-$997/mo retainers) sitting idle.
3. **Lint/test infrastructure setup** — no test or lint config exists anywhere in the repo. Before further autonomous sessions, add at minimum `eslint` + a smoke-test script per subsystem (trevo/milly/reeve) so future sessions can satisfy the "no commit without lint+test" rule with an actual tool rather than `node --check` alone.

## 5. Env vars needed — complete list, where to get them

**Trevo (root)**
- `OUTSCRAPER_API_KEY` — outscraper.com (Scout)
- `ANTHROPIC_API_KEY` — console.anthropic.com (Diagnoser/Checker)
- `ZOHO_EMAIL` / `ZOHO_APP_PASSWORD` — Zoho Mail → app-specific password
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_PHONE` / `TWILIO_WEBHOOK_SECRET` — console.twilio.com (blocked by A2P pending)
- `APOLLO_API_KEY` — apollo.io Basic plan ($49/mo)
- `REPORT_TO_EMAIL`, `CONTRACTOR_EMAIL`, `CALCOM_LINK`, `SITE_START_URL` — optional, set per preference

**Milly** (`milly/.env`)
- `BUFFER_ACCESS_TOKEN` — buffer.com/developers, classic token only
- `BUFFER_INSTAGRAM_PROFILE_ID` — via profiles.json curl, see MILLY_SETUP.md
- `ANTHROPIC_API_KEY` — same as above
- `SERPAPI_KEY` — optional, serpapi.com (else evergreen fallback)
- `UNSPLASH_ACCESS_KEY` — optional, unsplash.com/developers (else gradient fallback, confirmed working)

**Reeve** (`reeve/.env`)
- `META_VERIFY_TOKEN` — any string, must match Facebook App webhook config
- `META_APP_SECRET` — Facebook App → Settings → Basic
- `META_PAGE_ACCESS_TOKEN` — Graph API Explorer, needs `instagram_manage_messages` + `pages_messaging`
- `INSTAGRAM_PAGE_ID` — numeric Page ID from Meta
- `ANTHROPIC_API_KEY` — same as above
- `DAVE_NOTIFY_EMAIL`, `ZOHO_EMAIL`, `ZOHO_APP_PASSWORD` — optional, for high-fit lead alerts
- `CALL_BOOKING_LINK` — optional, falls back to shared Trevo Cal.com link (see blocker #4)

**Stripe / Formspree (no env var — hardcoded constants/IDs in HTML)**
- `STRIPE_LINK_WEBSITE` / `STRIPE_LINK_NORA` / `STRIPE_LINK_ATLAS` / `STRIPE_LINK_ARGUS` — paste into website/checkout/index.html
- Formspree form ID — paste into website/intake/index.html
