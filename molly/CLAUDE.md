# Molly — Content Engine

## What Molly is

Molly is the Instagram (live) / LinkedIn (scoped, not launched) content engine for Trevo
Advisors. Architectural sibling of Milly (Reeve) and Miley (Techs4Tatas) — same
Researcher → Generator → Designer → Scheduler pipeline shape, same file layout
(`agents/`, `lib/`, `templates/`, `scripts/`, `output/`).

Molly is the only sibling with no `CLAUDE.md` and no GitHub Actions workflow until this
file — it has been run manually. That gap is deliberate for now, not dropped: see
"Deferred" below and the reasoning in root `CLAUDE.md`'s session notes. Automating an
untested content voice just automates unmeasured posting.

This file is the authoritative brand-voice and targeting spec, current as of
2026-07-18. It supersedes `templates/brand-voice.json`'s prior `audience`/`core_pain`
framing (that file predates this spec and is stale — see "Known conflicts" below).

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

## Approval flow (scoped, not built)

Clone Miley's pipeline exactly: generate → render → Netlify review page → one-tap phone
approval → post via Meta API. `FORCE_QUEUE=1` as the gate. Nothing posts unapproved.

**One addition specific to Molly — claims check.** Any queued post containing a
statistic, a delivery-time reference, or a teardown image gets visually flagged on the
review page so it is reviewed deliberately rather than tapped through. These three
categories are where the reputational risk lives.

---

## Known conflicts with existing content (found, not yet fixed)

`templates/brand-voice.json` and `templates/evergreen.json` predate this spec and
violate it throughout — flagged here rather than silently rewritten, since fixing this
is a real content task (verifying real sourced statistics), not a config edit:

- `brand-voice.json`'s `core_pain` field states "3-5 jobs per week" (unsourced) and
  "closes that gap in 48 hours" (a hard delivery promise, not the sparing "in as little
  as two days" framing this spec requires).
- `evergreen.json` reuses the same unsourced "3-5 times a week" figure across at least
  6 posts (ev bodies referencing "Slide 5," the Denver/Phoenix client-result posts, and
  both reel scripts) — violates both the sourcing rule and the no-more-than-a-handful
  reuse rule.
- Multiple `evergreen.json` posts state "48 hours" as the headline/CTA repeatedly (e.g.
  "48-hour build," "Live in 48 hours. DM us the word demo.") — violates "never the
  headline, do not build a campaign around speed."
- Two posts (the "Denver plumber... 14 new jobs" story and the "Handyman in Phoenix...
  143 reviews" story) present specific, detailed client results with no indication of a
  real consenting client — these read as fabricated case studies and violate "no
  before-and-after client results until there is a real client who has consented."
- Several posts reference specific cities (Denver, Phoenix) — violates the national,
  no-city-or-region targeting rule.
- At least one post states price directly ("$100 and it's live") — violates "never
  state price."

Fixing this means regenerating the evergreen content library against this spec's
content pillars and sourcing rules, not patching individual lines — flagged as a real
next step, not done in this pass.

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
    instagram-insights.js
    sources.js
  templates/
    brand-voice.json      # stale — see "Known conflicts" above
    contractor-glossary.json
    evergreen.json         # stale — see "Known conflicts" above
    post-formats.json
    sources.json
  scripts/
    setup.js
    push-queue.js
    test-pipeline.js
    generate-evergreen.js
  output/
    briefs/
    content/
```

No GitHub Actions workflow exists yet — see "Deferred" and the note at the top of this
file for why.
