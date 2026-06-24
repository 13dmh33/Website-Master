# Reeve — Speaker Booking Agent

## What Reeve is

Reeve is an AI-powered speaker booking agency. It finds speaking opportunities for clients, pitches them, and manages follow-up — systematically. Clients pay a monthly retainer ($597–$997/mo) and Reeve runs their outbound booking pipeline.

Reeve is the business. Milly is its marketing engine. This directory is Reeve's operational brain.

## The core loop

```
Milly posts 4x/week → speaker sees content → DMs "stages"
  → Reeve DM agent qualifies them (3 questions, ~2 min)
  → scored: high / mid / low
    high → book call with Dave (automated)
    mid  → flag Dave for manual review
    low  → warm decline, keep following
  → Dave signs client → Reeve runs their pipeline
```

## Business model

- **Client retainer:** $597/mo (starter) · $997/mo (full pipeline)
- **What clients get:** weekly conference research, pitch writing, CFP submission support, follow-up management, booking negotiation
- **Differentiation:** Bureaus take 20–30% per gig. Reeve is flat-fee outbound — clients keep 100% of their fee.
- **Target client:** Speaker with 1–5 paid gigs/year, fee $2,500–$7,500, specific niche, ready to scale

---

## Build status (2026-06-03)

### Phase 1: DM Qualifier ✅ BUILT

| File | Purpose |
|------|---------|
| `agents/dm-agent.js` | Express server — Meta webhook handler, conversation flow, sendDM |
| `lib/qualifier.js` | Claude-powered scoring + graceful response generation |
| `lib/state.js` | File-based conversation persistence (one JSON per sender) |
| `templates/qualification.json` | All trigger keywords, questions, scoring actions, message templates |
| `scripts/test-qualify.js` | 3 test scenarios — high/mid/low fit |

### Phase 2: Conference Scout ✅ BUILT
`agents/conference-scout.js` — weekly SerpApi search for open CFPs (papercall.io, sessionize.com, Google, plus a query per distinct topic across active clients, capped at 3). Deduplicates against existing pipeline. `--dry-run` and `--summary` flags.
- **Cost cap:** `reeve/config/scout-config.json` + `lib/cost-tracker.js` — `$5/mo` SerpApi cap, `$0.015/search` estimate, tracked per-search and reset monthly (mirrors Trevo's `config/scout-config.json` pattern). Scout stops searching mid-run if the cap is hit.
- **Auto-close:** `lib/opportunity-store.js#closeExpiredOpportunities()` runs at the start of every scout run and `--summary` call — flips any `open` opportunity past its `cfpDeadline` to `closed` (`closedReason: "deadline_passed"`) so Pitcher never pitches a dead CFP.
- **Cron:** `.github/workflows/reeve-weekly-scout.yml` — Monday 6am MT (same slot as Milly), `workflow_dispatch` for manual runs, commits new opportunities + cost-cap state back to `main`. **Needs `SERPAPI_KEY` added as a GitHub Actions secret before this will run successfully.**

### Phase 3: Pitcher ✅ BUILT
`agents/pitcher.js` — topic-matches clients to open opportunities, Claude drafts pitch emails. All output saved as drafts. Dave reviews via `scripts/review-drafts.js`.

### Phase 4: Follower ✅ BUILT
`agents/follower.js` — finds sent pitches >14 days old with no response, Claude drafts follow-up emails. Dave reviews before send.

### Phase 5: Reporter ✅ BUILT
`agents/reporter.js` — weekly digest per active client (pitches sent/pending/accepted, pipeline totals). Claude writes the email. Dave reviews before send.

### Phase 6: Closer ✅ BUILT
`agents/closer.js` — when a conference accepts a pitch (`scripts/record-response.js` → accepted), Claude drafts two emails: (1) logistics confirmation to the conference organizer, (2) good-news update to the client/speaker. Also increments `bookings_confirmed` on the client profile.

---

## Phase 1: DM Qualifier — full detail

### Conversation flow

```
Speaker DMs "stages" (or "STAGES", "Stages")
  → Trigger detected → stage = q1
  → Q1: "How many paid gigs in the last 12 months?"
  → Answer stored → stage = q2
  → Q2: "What's your current keynote fee?"
  → Answer stored → stage = q3
  → Q3: "What's your primary speaking topic/niche?"
  → All 3 answers → Claude scores → routing message sent → stage = routed
```

### Scoring rubric (in `lib/qualifier.js`)

4-tier scoring model aligned with Reeve's tiered pricing:

| Score | Criteria | Tier | Price |
|-------|----------|------|-------|
| `high` | 5+ paid gigs AND $5k+ fee AND clear niche | Full | $597/mo |
| `mid` | 1–4 gigs OR $2,500–$5k fee AND some niche | Pitch | $297/mo |
| `scout` | 0 paid gigs BUT motivated AND clear niche | Scout | $97/mo |
| `low` | 0 paid gigs AND vague niche / no real speaking identity | — | Decline |

All 3 signals combined → single score. Claude is told to be strict — vague answers pull the score down.

### Routing actions

| Score | Action | Tier offered | Message |
|-------|--------|-------------|---------|
| `high` | Book a call — sends Cal.com link | Full $597/mo | Automated |
| `mid` | Flag Dave for manual review | Pitch $297/mo | Automated |
| `scout` | Offer Scout tier | Scout $97/mo | Automated |
| `low` | Decline | — | Automated |

### Re-trigger protection

If a sender who has already been routed DMs "stages" again, they are silently ignored. Avoids duplicate routing for the same lead.

### Scout follow-up flow

If a routed lead scored `scout` and replies with a positive message ("yes", "interested", "tell me more", etc.):
1. Agent sends `scout_followup` message — explains $97/mo Scout tier, asks for email
2. Sets `convo.scoutFollowupSent = true` so the same message isn't re-sent
3. Notifies Dave via email with subject "Scout lead replied YES — ready to convert at $97/mo"
4. Dave collects their email reply and handles billing manually until Scout signup is automated

If they message again after the follow-up has already been sent, they receive `scout_already_responded`.

### Conversation state shape

```json
{
  "senderId": "17841412345678",
  "senderName": "Jane Speaker",
  "startedAt": "2026-06-03T14:22:00.000Z",
  "lastActivity": "2026-06-03T14:25:11.000Z",
  "stage": "routed",
  "answers": {
    "paid_talks_count": "3",
    "fee_range": "$4,000",
    "topic": "women in tech leadership"
  },
  "score": "mid",
  "routed": true,
  "routedAt": "2026-06-03T14:25:12.000Z"
}
```

### Message templates (`templates/qualification.json`)

- `trigger_reply` — Q1 sent immediately on trigger (same as Q1 text)
- `high_fit` — includes `{CALL_BOOKING_LINK}` substitution
- `mid_fit` — "Dave will follow up within 24 hours"
- `low_fit` — warm decline, keeps them following

### Webhook security

- `GET /webhook` — Meta hub verification handshake (compare `hub.verify_token`, return `hub.challenge`)
- `POST /webhook` — HMAC-SHA256 signature verification via `X-Hub-Signature-256` header
- Length guard before `crypto.timingSafeEqual()` prevents RangeError
- Echoes (page-sent messages) are skipped via `is_echo` check
- Self-messages skipped by comparing `senderId === INSTAGRAM_PAGE_ID`

---

## Environment variables

```
# Required — DM Agent won't start without these
META_VERIFY_TOKEN=         # Any string you choose — set the same value in Facebook App webhook config
META_APP_SECRET=           # Facebook App Settings → Basic → App Secret
META_PAGE_ACCESS_TOKEN=    # From Graph API Explorer; needs instagram_manage_messages permission
INSTAGRAM_PAGE_ID=         # Numeric ID of the Instagram Business account
ANTHROPIC_API_KEY=         # For qualifier scoring

# Optional
DAVE_NOTIFY_EMAIL=         # Email Dave when a high-fit lead is routed
CALL_BOOKING_LINK=         # Cal.com link sent in high_fit message (e.g. cal.com/reeve/discovery)
PORT=3000                  # Default 3000
```

---

## Activation checklist (not yet done)

### Step 1: Facebook App setup
1. Go to `developers.facebook.com` → Create App → Choose "Business"
2. Add product: **Instagram** → Messenger
3. Add product: **Webhooks**
4. In App Settings → Basic: copy the **App Secret** → `META_APP_SECRET`
5. Set App to Live mode

### Step 2: Instagram Business account
1. Connect the Instagram Business account (@reeve.agency) to the Facebook App
2. Generate a Page Access Token with `instagram_manage_messages` + `pages_messaging` permissions
3. Copy the token → `META_PAGE_ACCESS_TOKEN`
4. Get the numeric Page ID → `INSTAGRAM_PAGE_ID`

### Step 3: Deploy to Railway
1. `railway init` in `reeve/` directory
2. Set all 5 required env vars in Railway dashboard
3. Deploy: `railway up`
4. Copy the generated Railway URL (e.g. `https://reeve-dm.up.railway.app`)

### Step 4: Register webhook with Meta
1. In Facebook App → Webhooks → Subscribe to: `messages` field on `instagram` object
2. Callback URL: `https://reeve-dm.up.railway.app/webhook`
3. Verify Token: same string as `META_VERIFY_TOKEN`
4. Click Verify — Meta will call `GET /webhook` and dm-agent.js will respond with the challenge

### Step 5: Set Cal.com link
1. Create a 20-minute "Reeve Discovery" event at cal.com
2. Copy the booking URL → `CALL_BOOKING_LINK` env var in Railway

### Step 6: Test
```bash
cd reeve
node scripts/test-qualify.js
```
Three scenarios run: high fit (8 talks, $7,500 fee, leadership topic), mid fit (3 talks, $3k, general motivation), low fit (0 talks, no fee, various topics). Check console output for scores and routing messages.

---

## Running the DM agent locally

```bash
cd reeve
npm install

# Copy .env.example to .env and fill in values
cp .env.example .env

# Start the server
node agents/dm-agent.js

# In a separate terminal — expose locally for Meta webhook testing
npx ngrok http 3000
# Copy ngrok URL → paste as webhook callback in Facebook App dashboard
```

Console on startup shows which required/optional vars are present and which are missing.

---

## Data persistence

`lib/state.js` — file-based, one JSON per sender in `output/conversations/`.

All functions:
- `getConversation(senderId)` — returns object or null
- `saveConversation(senderId, data)` — stamps `lastActivity` automatically
- `clearConversation(senderId)` — removes file (call after archiving if desired)
- `getAllActive()` — returns array of all open conversations
- `createFreshConversation(senderId, senderName)` — new default-shape object

Files are never auto-deleted after routing. They accumulate as a lead log. To archive, move them to `output/archive/conversations/` manually or build a cron job.

---

## The Milly → Reeve flywheel (full picture)

```
MILLY (content)                      REEVE (operations)
─────────────────────────────────────────────────────────────────
Researcher finds angles              [Phase 2] Conference Scout
  → speaking industry pain             → finds open CFPs weekly
  → conference deadlines               → saves to opportunities.json

Generator writes 4 posts             [Phase 3] Pitcher
  → carousel, caption, reel, found     → drafts pitches per client
  → 4 pillars: booking/mindset/         → custom per conference
    automation/business                 → Dave reviews before send

Designer renders images              [Phase 4] Follower
  → Unsplash or niche gradient         → 14-day follow-up if no reply
  → 1080x1080 PNG, teal+dark navy      → tracks all touchpoints

Scheduler posts via Buffer           [Phase 5] Reporter
  → Tue/Thu/Sat/Sun schedule           → weekly digest per client
  → CTA: DM "stages"                   → pitches sent, responses, pipeline

Analyst measures engagement          [Phase 6] Closer
  → updates brand-voice.json           → fee negotiation drafts
  → top hashtags, what's working       → Dave reviews before send

High-signal post detected            [Phase 1 ✅] DM Qualifier
→ lib/reeve-handoff.js fires           → "stages" → 3 questions
→ alert to Dave                        → Claude scores → routes
                                       → high: book call
                                       → mid: flag Dave
                                       → low: warm decline
```

---

## File structure

```
reeve/
  CLAUDE.md               ← you are here
  .env.example            ← env var template
  package.json
  agents/
    dm-agent.js           ✅ Phase 1 — webhook server + conversation flow + Dave notifications
    conference-scout.js   ✅ Phase 2 — CFP discovery (SerpApi, deduplication)
    pitcher.js            ✅ Phase 3 — topic matching + Claude pitch drafts
    follower.js           ✅ Phase 4 — 14-day follow-up on unanswered pitches
    reporter.js           ✅ Phase 5 — weekly client digest drafts
    closer.js             ✅ Phase 6 — conference confirmation + client good-news emails
  lib/
    qualifier.js          ✅ Phase 1 — Claude scoring + response generation
    state.js              ✅ Phase 1 — DM conversation persistence
    client-store.js       ✅ Phase 2 — client profiles CRUD
    opportunity-store.js  ✅ Phase 2 — conference/CFP pipeline CRUD + auto-close on deadline
    cost-tracker.js       ✅ Phase 2 — SerpApi monthly spend cap
  config/
    scout-config.json     ✅ Phase 2 — SerpApi cap state ($5/mo default, resets monthly)
  templates/
    qualification.json    ✅ Phase 1 — trigger words, questions, messages, routing
    client-profile.json   ✅ Phase 2 — client schema reference + example
  scripts/
    test-qualify.js       ✅ Phase 1 — 3-scenario qualification test
    onboard-client.js     ✅ Phase 2 — interactive client setup wizard (--from-dm flag)
    review-leads.js       ✅ Phase 1.5 — review routed DM leads, launch onboarding
    review-drafts.js      ✅ All — approve/reject/send pitch/followup/closer/report drafts
    record-response.js    ✅ Phase 6 — log conference response; triggers closer.js
  output/
    conversations/        ← one JSON per DM sender (runtime)
    clients/              ← one JSON per onboarded client (runtime)
    opportunities/        ← one JSON per conference/CFP (runtime)
    pitches/              ← all draft types: pitch, followup, closer, report (runtime)
```

---

## Phase 2 data models (planned)

### Client profile (`output/clients/{clientId}.json`)
```json
{
  "id": "client-001",
  "name": "Jane Speaker",
  "email": "jane@example.com",
  "instagramHandle": "@janespeaker",
  "talkTitle": "The Future of Women in Tech Leadership",
  "talkDuration": [20, 45, 60],
  "bio": "...",
  "fee": { "min": 4000, "max": 7500 },
  "topics": ["women in tech", "leadership", "DEI"],
  "retainerTier": "full",
  "startDate": "2026-06-10",
  "status": "active",
  "leadSource": "instagram_dm",
  "dmSenderId": "17841412345678"
}
```

### Opportunity (`output/opportunities/{conferenceId}.json`)
```json
{
  "id": "opp-001",
  "conference": "SaaStr Annual 2027",
  "url": "https://papercall.io/saastr-2027",
  "cfpDeadline": "2026-09-15",
  "topic": "SaaS, leadership, growth",
  "fee": "unpaid/honorarium",
  "clientsTargeted": ["client-001"],
  "status": "open",
  "foundAt": "2026-06-09",
  "pitchedAt": null,
  "response": null
}
```

---

## Common failure modes (Phase 1)

**Webhook returns 403 on verification**
`META_VERIFY_TOKEN` in the agent doesn't match what you entered in the Facebook App dashboard. They must be identical strings.

**Webhook returns 401 on incoming messages**
`META_APP_SECRET` is wrong or the signature header format changed. Check that the App Secret is from Facebook App Settings → Basic (not the token).

**Agent ignores all incoming DMs**
Check that the `messages` field is subscribed in Facebook App → Webhooks → Instagram. Also confirm the app is in Live mode (not Development mode — Development mode only delivers events from test accounts).

**Claude score always comes back "mid"**
JSON parse failure fallback returns mid by design. Check console for `[qualifier] Could not parse scoring JSON` logs. Usually means Claude returned markdown-wrapped JSON despite being told not to — the strip regex handles most cases.

**"stages" trigger not firing**
Trigger matching is exact-string. The prospect must send exactly "stages", "STAGES", or "Stages" — no extra words, no punctuation. Consider adding "stages." and "stages!" to `trigger_keywords` in `qualification.json` if needed.

**Conversation stuck in q1/q2/q3 forever**
`state.js` stores the conversation file. If the server restarts, it reads the file and resumes from the current stage. If it seems stuck, check `output/conversations/{senderId}.json` and inspect the stage value.
