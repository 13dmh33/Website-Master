# Miley Roadmap — Build Specs

Each spec below is self-contained: hand the whole section to a future Claude session
as the task brief. They're ordered roughly by build effort (smallest first), not priority.

Saved for later (not specced yet): narrative week-long arcs, UGC ingestion pipeline,
multi-platform reflow (TikTok/Pinterest), live donation tracker post type.

---

## 1. Generate-then-judge pipeline — ✅ BUILT (2026-06-23)

**Problem today:** `agents/generator.js` asks Claude for one post per slot, runs it through
`generator-prompts.passesQualityGate` (a hard pass/fail on freebie/donation/length/hashtag
rules), and falls back to evergreen on any miss. There's no way to pick the *best* post —
only "compliant" or "not compliant."

**Build:**
- Change the generation call to request N variants (3–5) per slot in one Claude call
  (or N parallel calls) instead of one.
- Add a second Claude call — a "judge" pass — that scores each variant against a richer
  rubric: hook strength, whether the donation line lands naturally vs. feels bolted-on,
  humor/voice fit, CTA clarity. Return a score + one-line reasoning per variant.
- Keep the existing `passesQualityGate` as a pre-filter (hard rules) before judging —
  don't let the judge override brand-safety rules, only break ties among compliant variants.
- Log judge scores somewhere reviewable (`output/content/content-{week}.json` already has
  room to add a `judge` field) so Dave can see *why* a post won in the preview HTML.

**Files touched:** `agents/generator.js`, `agents/generator-prompts.js` (new judge prompt),
`lib/claude.js` (likely needs a second call type), `scripts/test-pipeline.js` (extend to
exercise the judge path).

**Open questions for Dave:** Is doubling/quintupling the Claude spend per week
(N variants + 1 judge call) worth it given the $ budget elsewhere in this codebase
(Diagnoser caps at $5/mo, Checker at $3/mo)? May want a cost cap here too.

**Effort:** Medium-large (~half day). Touches the core generation loop and needs careful
prompt design for the judge to be meaningfully different from the quality gate.

---

## 2. Self-critique loop using past top performers — ✅ BUILT (2026-06-23)

**Problem today:** The Generator has no memory of what's actually worked. `brand-voice.json`
has `what_works` / `top_hashtags` fields that the Analyst updates from engagement data, but
the Generator doesn't read full past posts back in as examples — it's effectively starting
fresh every week guided only by the static brand-voice rules.

**Build:**
- Extend `agents/analyst.js` to not just bump `what_works`/`top_hashtags` but to tag and
  store the *actual top 3–5 posts* (full caption text) per content type, ranked by
  engagement or click-through, in a new file (e.g. `templates/top-performers.json`).
- In `agents/generator-prompts.js`, inject the top 2–3 same-content-type posts as few-shot
  examples in the prompt ("here's what's landed recently — match this energy, don't repeat
  it verbatim").
- Add decay/rotation so the few-shot set doesn't go stale — e.g. only keep performers from
  the last 90 days, re-rank monthly.

**Files touched:** `agents/analyst.js`, `agents/generator-prompts.js`, `lib/store.js`
(new accessor), new template file `templates/top-performers.json`.

**Open questions for Dave:** Needs real engagement data flowing in (Instagram Graph API
token) to be meaningful — without it, this has nothing to learn from. Worth gating the
build until that's live, or build it now and let it sit dormant.

**Effort:** Medium (~half day), small if Analyst's existing data shape is reused as-is.

---

## 3. Multiple Riley personas

**Problem today:** All content comes from one voice — "Riley Brooks" — defined once in
`brand-voice.json` and baked into `agents/generator-prompts.js`'s SYSTEM_PROMPT. Good for
consistency, limits range.

**Build:**
- Define 2–4 persona variants in `brand-voice.json` (or a new `personas.json`) — e.g.
  "Riley" (general/scrappy), an electrician-flavored voice, a plumber-flavored voice —
  each with its own tone notes, vocabulary tilts, and signature phrases, but all staying
  within the existing hard brand rules (anonymous, no face reveal, no sob stories).
- Add persona selection logic to `lib/planner.js` — could rotate by content type (humor
  posts always get a specific persona) or randomize with weighting.
- Update `agents/generator-prompts.js` to parameterize the SYSTEM_PROMPT by persona instead
  of hardcoding "Riley."
- Update `evergreen.json` fallback posts to be persona-tagged too, or keep evergreen as
  persona-neutral fallback only.

**Files touched:** `templates/brand-voice.json` (or new `templates/personas.json`),
`lib/planner.js`, `agents/generator-prompts.js`, `agents/generator.js`.

**Open questions for Dave:** Does brand identity want a single consistent narrator (current
design, easier to build follower attachment) or does variety serve the brand more? This is
a brand decision, not just a technical one — worth deciding before building.

**Effort:** Medium (~half day) — mostly prompt/config work, low code risk.

---

## 5. Richer visual template system

**Problem today:** `lib/canvas-render.js` has one layout per content type (`renderQuoteCard`,
etc. — single fixed composition), with product-photo-or-gradient as the only background
variation. Every post of the same type looks structurally identical.

**Build:**
- Add 2–3 layout variants per content type (e.g. for `product_feature_single`: centered
  product shot vs. corner-accent shot vs. text-forward with small product inset).
- Add a meme-style template (top/bottom text bars over an image) for `trades_humor` —
  distinct from the current quote-card look, since humor posts often perform better in
  meme format on IG.
- Add collage/multi-image composition support for when real customer or lifestyle photos
  exist (`assets/lifestyle/`), since right now that folder is unused even when populated.
- Wire variant selection into `lib/planner.js` (rotate or randomize per post) and have the
  Scheduler/preview show which layout was used.

**Files touched:** `lib/canvas-render.js` (new render functions), `lib/planner.js`
(layout selection), `templates/visual-config.json` (per-layout palette/sizing config).

**Open questions for Dave:** Needs the placeholder brand colors finalized first (separate,
already-flagged item) since every new layout will need to look right in real brand colors,
not the placeholder pink.

**Effort:** Medium-large (~half to full day) — skia-canvas layout work is fiddly; budget
time for visual QA across all new layouts × both light/dark palettes.

---

## 7. True multivariate testing (multi-armed bandit)

**Problem today:** `lib/ab-tracker.js` does epsilon-greedy (20% explore / 80% exploit) on
exactly one dimension — caption variant (A vs. B), alternated weekly, with `MIN_SENDS=3`
bootstrap. Posting time, CTA type, and visual style are not tested at all.

**Build:**
- Generalize `lib/ab-tracker.js` from a single A/B caption switch into a proper multi-armed
  bandit (Thompson sampling or epsilon-greedy generalized) over multiple independent
  dimensions: hook style, CTA type, posting time slot, visual layout (once #5 exists).
- Each dimension needs its own arm-performance tracking in `config/template-stats.json`-style
  storage (Miley's analog — check if one exists or needs creating) keyed by dimension+arm.
- Scheduler needs to pull an arm per dimension per post and record the choice; Analyst needs
  to record the outcome (clicks/engagement) per arm per dimension, not just per caption.
- Watch for combinatorial explosion — 4 dimensions × 3 arms each = 81 combinations on a
  4-post/week cadence will take a long time to reach statistical significance. May need to
  test dimensions sequentially (lock in winning hook style before testing CTA) rather than
  all at once.

**Files touched:** `lib/ab-tracker.js` (rewrite), `agents/scheduler.js`, `agents/analyst.js`,
new/extended stats file.

**Open questions for Dave:** Given current low post volume (4/week), is a true bandit
overkill vs. just testing one dimension at a time sequentially? Worth discussing before
building — this is the most statistically involved item on the list.

**Effort:** Large (~1 full day) — this is the most architecturally involved item here.

---

## 8. Sentiment mining from comments/DMs — ✅ BUILT (2026-06-23)

**Problem today:** `agents/analyst.js`'s "sales signal" only reads UTM click data
(`output/clicks/latest.json`) — it ranks products by click-through but has no visibility
into *qualitative* audience reaction (comments, DM sentiment, what jokes land vs. fall flat).

**Build:**
- Add an ingestion point for comment/DM text — likely via Instagram Graph API (comments
  endpoint, since `lib/instagram-insights.js` already wraps Graph API for the Analyst) or
  a manual export Dave drops in (`output/comments/latest.json`, same pattern as clicks).
- Run a lightweight Claude classification pass over new comments: sentiment (positive/
  negative/neutral), and tag *why* (joke landed, donation message resonated, product
  desire, complaint) — cheap since comment volume is small.
- Feed aggregated sentiment back into `brand-voice.json`'s `what_works`, alongside (not
  replacing) the existing click-based signal, so tone evolution isn't purely
  revenue-driven.

**Files touched:** `agents/analyst.js`, `lib/instagram-insights.js` (extend for comments),
new `lib/sentiment.js`, `output/comments/` (new dir, gitignored like clicks).

**Open questions for Dave:** Needs Instagram Graph API token live to pull comments at all
(same blocker as #2) — comment-level data isn't available without it. Manual-export path
works without the token but means Dave has to do the exporting.

**Effort:** Medium (~half day), small additional Claude cost (classification is cheap
per-comment).

---

## 9. Dynamic product-rotation weighting — ✅ BUILT (2026-06-23)

**Problem today:** `lib/planner.js` rotates through `product_catalog_rotation`
(an ordered list in `post-formats.json`) round-robin — every product gets equal airtime
regardless of how it performs.

**Build:**
- Extend the Analyst's click-through ranking (already computed for the Analyst's own
  reporting) into an actual weight that `lib/planner.js` reads when choosing which product
  to feature next — e.g. softmax over click-through rate instead of strict rotation order,
  with a floor weight so low-performing/new products still get some airtime (avoid
  starving the catalog).
- Needs a decay mechanism so a product's early bad luck doesn't permanently bury it —
  rolling window (last N weeks) rather than all-time average.
- Should respect catalog changes from `scripts/scrape-catalog.js` — new products start at
  a neutral default weight, not zero.

**Files touched:** `lib/planner.js`, `agents/analyst.js` (expose per-product CTR, not just
ranking), `templates/post-formats.json` (may need a weights field alongside the rotation
list).

**Open questions for Dave:** Same data dependency as #2/#8 — needs real click data
(`output/clicks/latest.json`) flowing in to have anything to weight on. Low value until
GA4/Pixel + linkpage are actually live and collecting clicks.

**Effort:** Medium (~half day) — mostly `lib/planner.js` logic change, low risk to the rest
of the pipeline since it's a drop-in replacement for the existing rotation function.

---

## 10. Cultural/seasonal calendar engine — ✅ BUILT (2026-06-23)

`templates/calendar.json` (5 entries, real-world-verified dates), `lib/calendar.js` (rule
evaluator: `nth_weekday_of_month` / `first_full_week_of_month` / `monthly_day` /
`explicit_range`), `lib/planner.js` (base/september branch only — October still fully owned
by `october-campaign.json`), `agents/researcher.js` + `agents/generator.js` (brief/prompt
injection). Tested: WIC Week, Skilled Trades Day, Mother's Day, National Apprenticeship Week,
monthly self-exam reminder all fire on the correct weeks; non-matching weeks fall through to
normal rotation unchanged.

<details><summary>Original spec</summary>

**Problem today:** Seasonal awareness is fully static — `october-campaign.json` hardcodes
the one big seasonal overlay (Pink October), and `lib/planner.js` checks `isOctober` as
basically the only calendar-aware branch. Everything else (Women in Construction Week,
Skilled Trades Day, Mother's Day, Small Business Saturday, etc.) is invisible to the system
unless Dave manually adds an evergreen post for it.

**Build:**
- Create a `templates/calendar.json` (or similar) listing recurring dates/weeks relevant to
  both brand beats — trades observances (NAWIC's Women in Construction Week, Skilled Trades
  Day) and breast-cancer-adjacent dates beyond October (e.g. early detection awareness
  moments), each with a suggested content angle and whether it overrides or supplements
  that week's normal rotation.
- Extend `lib/planner.js`'s mode resolution (currently `base` / `september` / `october`) to
  check the calendar for the current week and inject a calendar-driven slot/theme when a
  match exists, falling back to normal rotation otherwise.
- Feed the matched calendar entry into the Researcher's brief (`agents/researcher.js`) the
  same way `inspiration-sources.json` themes are fed in now, so the Generator gets the
  seasonal angle as context.

**Files touched:** new `templates/calendar.json`, `lib/planner.js`, `agents/researcher.js`.

**Open questions for Dave:** None blocking — this is buildable entirely offline with public
observance-date data, no account dependencies. Good candidate to build before the
account-gated items above.

</details>

**Effort:** Medium (~half day) — mostly data entry (researching the right observance dates)
plus a moderate `lib/planner.js` extension.

---

## Suggested build order

Given the dependencies called out above, a sensible order for a future session:

1. **#10 (calendar engine)** — ✅ built 2026-06-23.
2. **#3 (personas)** — no account dependencies, but get Dave's brand-voice decision first.
3. **#5 (visual templates)** — no account dependencies, but wait on real brand colors.
4. **#1 (generate-then-judge)** — needs an ANTHROPIC_API_KEY to test for real, but can be built/dry-run with evergreen stand-ins.
5. **#9 (product weighting)**, **#2 (self-critique)**, **#8 (sentiment mining)** — all gated on real click/engagement/comment data flowing in (GA4/Pixel/IG token). Build the plumbing now, but it stays dormant until those accounts are live.
6. **#7 (multivariate bandit)** — biggest lift, and arguably premature until post volume is higher; revisit after a few months of live data.
