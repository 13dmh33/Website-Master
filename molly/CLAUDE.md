# Molly — Content Engine

## What Molly is

Molly is the Instagram (live) / LinkedIn (scoped, not launched) content engine for Trevo
Advisors. Architectural sibling of Milly (Reeve) and Miley (Techs4Tatas) — same
Researcher → Generator → Designer → Scheduler pipeline shape, same file layout
(`agents/`, `lib/`, `templates/`, `scripts/`, `output/`).

**2026-07-27 update: automated.** GitHub Actions workflows now exist
(`.github/workflows/molly-weekly-pipeline.yml` + `molly-weekly-analytics.yml`, cloned
from Milly's proven pattern) and the evergreen fallback bank was rewritten clean — see
"Known conflicts" below, now resolved, and "Activation checklist" at the bottom for what
still needs Dave (Buffer token, secrets, merge to `main`). Everything below this point
that still describes Molly as manual-only is superseded by that.

This file is the authoritative brand-voice and targeting spec, current as of
2026-07-18 (content pillars, restrictions, targeting — unchanged by the 2026-07-27
automation work). It supersedes `templates/brand-voice.json`'s prior `audience`/`core_pain`
framing (that file was brought into line with this spec on 2026-07-18 — see "Known
conflicts" below).

---

## Who Molly is talking to

Owner-operators of small home service businesses — plumbers, electricians, HVAC techs,
roofers, handymen. They run the trade, not a marketing department. Most have no finance
or business background, which shapes everything below:

- They think in jobs and weeks, not CAC and conversion rates.
- They are cynical about marketing pitches because they get called by agencies constantly.
- They are competent and busy — not confused, just working.
- Many have a spouse or office manager running the Instagram account.

**Voice consequence:** talk in jobs, calls, and customers. Never in funnels,
impressions, conversion rates, or ROI. If a sentence would need explaining to someone
who has never read a marketing article, rewrite it.

**Tone:** peer, not consultant. Respectful of the trade. Never condescending about their
current website or lack of one — plenty of good contractors have bad websites because
they have been busy doing the work.

## Targeting

- **National.** No city or region references.
- **Trade agnostic.** Speak to contractors generally; never single out one trade.

Known limitation, deliberately accepted for now: this is the widest possible targeting
for a business with no case studies, and it prevents the specificity that makes content
feel personally written. Revisit once there is one closed deal in one trade — a real
local result is worth more than broad reach.

## What Molly sells

Trevo as a brand and the website as the entry point. The AI agent is present but
secondary — introduce it as something that exists, not as the pitch.

**Never state price.** Pricing stays off social entirely for now. If asked in comments
or DMs, the answer routes to a conversation, not a number.

**Delivery timing:** frame as "in as little as two days" — soft, occasional, never the
headline. It is a capability, not a promise, and it should not be the recurring hook. Do
not build a campaign around speed.

## The core problem Molly speaks to

A contractor's next customer looks them up before calling. When there is nothing to
find, or what they find looks abandoned, that customer calls the next name on the list.
The contractor never learns it happened.

That is the whole thesis. Everything else is an angle on it.

## Content pillars

1. **The invisible loss** — jobs lost before the phone ever rings. The core thesis, told
   different ways.
2. **What customers actually do** — how people choose a contractor now. Stat-backed.
   This is where sourced data lives.
3. **Anonymized teardowns** — common website mistakes, shown not told. Rules below.
4. **Quiet proof** — what a good contractor site does differently. No client work until
   there is a consenting client.
5. **The trade itself** — content that respects the work and has nothing to sell. Earns
   the right to post the other four.

## Statistics — sourcing rules

Every statistic carries its source and year visibly in the post. No exceptions.

**Approved primary sources:**
- BrightLocal — Local Consumer Review Survey (review and local search behavior)
- Think with Google — local intent, mobile search behavior
- Pew Research — internet and smartphone usage baselines
- SBA and BBB — small business operational data
- U.S. Census, BLS — business counts, employment by trade, market sizing
- ServiceTitan, Housecall Pro, Jobber annual reports — cite explicitly as vendor
  research, since they are vendor-published but built on real platform data

**Hard rules:**
- If a figure cannot be traced to a named primary source, it does not get used.
- Verify every figure at publish time. Do not trust a number baked into a template weeks
  earlier — these surveys update annually and a stale figure published as current is the
  reputational risk.
- No statistic gets reused across more than a handful of posts. Repetition of the same
  number reads as a script.
- Missed-call statistics are prohibited unless independently sourced. That figure is the
  most commonly recycled unsourced number in this space and Nora's pitch already leans
  on it.

## Teardowns

Permitted, with hard limits. The risk is not legal — it is that the entire prospect pool
is watching, and cold outreach becomes much harder if a contractor can find Molly
publicly criticizing a peer.

**Three permitted formats:**

1. **Anonymized** — logo, business name, phone, and address removed or blurred.
   Critique the pattern, never the business. Default format.
2. **Composite** — a fabricated contractor site built to contain several common
   mistakes, then torn down. Zero risk, fully controlled, reusable.
3. **Consented** — a real named site only if the owner asked for it in writing. Good
   content when it happens; never solicited by implication.

**Never:** a named real business, an identifiable phone number or address, or a
screenshot with the business name visible.

## Calls to action

**One CTA per post. Never stacked.** Same rule as the outreach drip.

Map by pillar:
- Educational and stat posts → save or follow
- Teardown and proof posts → learn more (link in bio)
- Offer posts → book a call

Offer posts should be the smallest share of the mix. If most posts are asking for a
booking, the account reads as an ad feed and engagement collapses.

## Restrictions — absolute

- **Never names the founder.** No personal name in any customer-facing copy, same rule
  as outreach. Personal signature only via env var where a signature is required.
- No emojis. Sentence case throughout.
- "AI agent" — never "bot."
- No income or revenue claims on the contractor's behalf. Never "make an extra $10k a
  month."
- No AI-replaces-your-staff framing. Contractors hear that as a threat, and it
  misrepresents what the AI agent does.
- No named competitors. No named real businesses.
- No unsourced statistics.
- No "business days" language.
- No before-and-after client results until there is a real client who has consented.
- No hard delivery-time promises. "In as little as two days" is the ceiling, used
  sparingly.

## Approval flow — built, 2026-07-27

Cloned Miley's queue-first pattern exactly: `agents/scheduler.js` runs the
`lib/brand-validator.js` hard gate on every post — before EITHER the review queue or a
live Buffer post — then, with `FORCE_QUEUE=1` (the GitHub Actions default) or no Buffer
token configured, writes each post to `output/queue/` plus a single
`output/queue/preview-{weekOf}.html` (dark navy/teal, matches the Trevo brand) with
every rendered image inlined. Dave reviews, then runs `node scripts/push-queue.js` to
push approved posts to Buffer — which re-checks the gate a second time as defense in
depth, in case a queue file was ever hand-edited. Nothing posts unapproved.

**The "claims check" this section originally scoped is now just the gate itself** —
`brand-validator.js` doesn't merely flag a statistic, delivery-time reference, or
client-result-shaped claim for review, it hard-rejects it before it ever reaches the
queue. Stricter than the original one-tap-phone-approval design, and simpler: there's no
separate Netlify review page or Meta API posting path, since Buffer already covers
scheduled posting once a token exists (see "Activation checklist" below).

---

## Known conflicts with existing content — resolved

`templates/brand-voice.json` and the original `templates/evergreen.json` predated this
spec and violated it throughout (unsourced stats, "48 hours" as a headline, two
fabricated-reading client-result posts with no consent on record, city references,
one post stating price directly). Fixed in two passes:

- **2026-07-18** (`d516c62`): the violating file was moved to
  `quarantine/evergreen-prespec.json` rather than deleted (real drafting material, just
  not postable as-is — see `quarantine/README.md`), and `lib/brand-validator.js` was
  built as a hard gate wired into both `scheduler.js` and `scripts/push-queue.js` —
  nothing that fails it reaches Buffer or the review queue, regardless of source.
  `brand-voice.json`'s `core_pain` field was also brought into line with this spec at
  the same time.
- **2026-07-27**: `templates/evergreen.json` was rewritten from scratch — 20 posts (5
  per format), every one passing `brand-validator.js`, deliberately avoiding hard
  statistics entirely (qualitative claims only) since this content runs unattended
  without per-post fact-checking. `lib/store.js`'s `PATHS.evergreen` now points back to
  the live file. Two related generation-path bugs fixed the same day: `generator.js`'s
  `trevo_found` prompt was instructing Claude to state the $65/mo price (guaranteed
  rejection by the gate — removed), and the reel script format's `HOOK`/`BODY`/`CTA`
  labels tripped the ALL-CAPS check (re-cased to `Hook`/`Body`/`Cta` in both the
  evergreen content and the live prompt).

`quarantine/evergreen-prespec.json` is untouched and still exists as raw drafting
material per its own README — just no longer wired into the live pipeline.

---

## Deferred — scoped, not building yet

### LinkedIn

Scoped and documented so the decision is preserved, but not launching alongside
Instagram. Do not reformat Instagram content for it when it does launch — the audience
and job are different.

- **Audience:** more established owners, plus the adjacent ecosystem already targeted
  in the aggregator outreach lanes — bonding and insurance agents, SBDCs and SCORE,
  trade schools, license-prep companies.
- **Format:** text-first, longer, business-outcome framing. Numbers and reasoning over
  visuals.
- **The real job:** LinkedIn content should be written to be forwarded by an SBDC
  advisor to a contractor — not read by the contractor directly. That makes it a
  partnership channel, which is worth more than consumer-side reach.
- **Trigger to launch:** after Instagram has enough posts to clear the engagement
  analyzer's sample gate, or when aggregator outreach starts producing partner
  conversations that need something to point at.

### Instagram DM catcher

Designed, not built. Architecture mirrors the Techs4Tatas engagement-triggered flow, so
most of this already exists.

- Netlify Function receiving Instagram webhook events.
- Triggers on engagement: comment, DM, or story reply on a Molly post.
- Supabase dedup so nobody is messaged twice.
- One welcome DM only — a qualifier question, never a pitch, no automated sequence.
- Any reply routes to Dave, not to an auto-responder.
- Logs to the same Google Sheets CRM so Molly-sourced and Scout-sourced leads live
  together.
- Lane tagged `molly-inbound` in `state.json`, additive only.
- Safety gate `MOLLY_DM_LIVE`, defaults false.

**Before building:** read Reeve's `check-high-signal.js` (see the "Reeve handoff"
section in `milly/CLAUDE.md`). It already performs engagement-to-DM handoff for Milly.
This may be a config change rather than a build.

### Pipeline connection

Later item: leads who have engaged with Molly content receive different cold outreach
than cold Scout leads. Not scoped yet.

---

## Open item

The engagement analyzer (see `engagement/` at repo root, once built) will almost
certainly report Molly as below the 20-post minimum sample gate on first run. That is
expected and correct. Molly's content decisions stay judgment-based until there is
enough posting history to measure — do not treat early analyzer output as signal.

---

## Activation checklist — what's left for Dave

The pipeline runs end-to-end today (verified 2026-07-27: research → generate → design →
schedule, real Claude calls, zero brand-validator rejections, real images rendered).
What's still manual:

- [ ] **Buffer classic token + Instagram Business profile ID** — same requirement as
  Milly/Miley, get a *classic* token from `buffer.com/developers` (OIDC tokens 401).
  Without it, the pipeline still runs and queues correctly — it just needs
  `node scripts/push-queue.js` run by hand instead of posting automatically.
- [ ] **Merge to `main`** — the workflows only trigger from the default branch.
- [ ] **Add GitHub Actions secrets**: `ANTHROPIC_API_KEY` (required — without it,
  generation still works via the evergreen bank, but with no live-research or
  Claude-drafted variety); `BUFFER_ACCESS_TOKEN` + `BUFFER_INSTAGRAM_PROFILE_ID` (for
  live posting); `SERPAPI_KEY` (optional — evergreen fallback runs every week without
  it, same as Milly); `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID`
  (analytics only).
- [ ] Once merged, `.github/workflows/molly-weekly-pipeline.yml` (Monday 6am MT) and
  `molly-weekly-analytics.yml` (Sunday 10pm MT) activate automatically —
  `workflow_dispatch` is available for a manual test run before then.

## File structure

```
molly/
  CLAUDE.md              # this file
  package.json
  agents/
    researcher.js
    generator.js
    designer.js
    scheduler.js
    analyst.js
  lib/
    store.js
    claude.js
    canvas-render.js
    buffer.js
    glossary.js
    ab-tracker.js
    brand-validator.js    # hard gate — see "Approval flow" above
    instagram-insights.js
    sources.js
    reel.js               # 2026-07-28 — reel .mp4 assembly, ported unchanged from Miley
    planner.js             # 2026-07-28 — weekly rotation single-source-of-truth
    calendar.js             # 2026-07-28 — date-specific observance matching
    sentiment.js             # 2026-07-28 — comment/DM sentiment classification
  templates/
    brand-voice.json      # brought into line with this spec 2026-07-18
    contractor-glossary.json
    evergreen.json         # rewritten 2026-07-27 — 20 posts, all pass brand-validator.js; reel posts restructured 2026-07-28 (hook/body/cta beats, see Reels below)
    post-formats.json
    sources.json
    calendar.json          # 2026-07-28 — contractor-relevant observances (see Reels/planner section below)
  quarantine/
    evergreen-prespec.json # old violating content, kept as raw drafting material — never read by the live pipeline
    README.md
  scripts/
    setup.js
    push-queue.js
    test-pipeline.js
    generate-evergreen.js
  docs/
    reels.md               # 2026-07-28 — reels engine reference
    review-workflow.md     # 2026-07-28 — weekly review routine
  test/
    brand-validator.test.js
    reel.test.js            # 2026-07-28
    canvas-render.test.js   # 2026-07-28
    planner.test.js         # 2026-07-28
    calendar.test.js        # 2026-07-28
    sentiment.test.js       # 2026-07-28
  output/
    briefs/
    content/
    images/
    queue/                # review queue + preview-{weekOf}.html
    comments/               # optional — drop latest.json here for sentiment mining
```

GitHub Actions: `.github/workflows/molly-weekly-pipeline.yml` +
`molly-weekly-analytics.yml` at the repo root (not inside `molly/`, matching where
Milly's and Miley's live) — see "Activation checklist" above for what's needed before
they run for real.

---

## Reels, planner, calendar, sentiment (2026-07-28)

Ported from Miley (Techs4Tatas), whose engine had built out further than Molly's.
Full reels detail: `docs/reels.md`. Summary of what changed:

- **Real reel videos.** The Sunday reel slot used to render a single static
  "reel hook" thumbnail (`renderReelHook`, still exported for compatibility but
  no longer called by `designer.js`). It now renders an actual vertical
  1080×1920 `.mp4` via `lib/reel.js` (ported unchanged from Miley — brand-
  agnostic) + new reel-frame renderers in `lib/canvas-render.js`
  (`renderReelFrame`, `renderReelWordFrame`, `tokenizeEmphasis`) using Trevo's
  navy/teal brand system. Two styles rotate weekly (`card` beat-cards,
  `kinetic_karaoke`/`kinetic_punch` word-by-word), silent by design, $0
  marginal cost via the bundled static ffmpeg (`@ffmpeg-installer/ffmpeg`).
  `lib/buffer.js` gained `uploadVideo` so a rendered reel actually posts as a
  video (falls back to an image post if upload fails).
- **Reel content shape changed.** `posts.reel` is now three short ON-SCREEN
  lines — `hook`/`body`/`cta` — instead of a timestamped "Hook (0-2s) / Body
  (2-14s) / Cta (14-20s)" voiceover script. `caption` is the separate IG
  caption text. `agents/generator.js`'s `generateReelScript` and
  `templates/evergreen.json`'s 5 reel posts were rewritten to this shape (all
  re-verified against `brand-validator.js`).
- **`lib/planner.js`** centralizes weekly rotation decisions that used to be
  scattered inline in `generator.js`: week number, caption/reel niche
  (wraps `store.getWeekNiches()`), the `trevo_found` demo-vs-agent rotation
  (moved `DEMOS`/`AGENTS` here from `generator.js`), the new reel visual-style
  rotation, and calendar context resolution. `generator.js`/`designer.js` call
  `planner.buildWeekPlan()` once per run instead of recomputing rotations
  independently.
- **`lib/calendar.js` + `templates/calendar.json`** — date-specific
  observances (National Skilled Trades Day, National Small Business Week,
  seasonal planning windows, a monthly reminder) that the planner folds into
  that week's prompts as extra angle context. Molly has no seasonal campaign
  mode (no September/October equivalent), so — unlike Miley, where a
  high-priority entry can override a slot's format — every active entry here
  just supplements the week's voice-context prompt; the fixed
  carousel/caption/trevo_found/reel schedule never changes.
- **`lib/sentiment.js`** — classifies exported comments/DMs
  (`output/comments/latest.json`) via a cheap Claude Haiku pass, wired into
  `agents/analyst.js`'s `runSentimentMining()` (runs regardless of whether
  Instagram insights are configured; no-ops gracefully with no export or no
  `ANTHROPIC_API_KEY`). Feeds `brand-voice.json`'s `sentiment_signal`.

Tests: `test/reel.test.js`, `test/canvas-render.test.js`, `test/planner.test.js`,
`test/calendar.test.js`, `test/sentiment.test.js` (47 total passing).
