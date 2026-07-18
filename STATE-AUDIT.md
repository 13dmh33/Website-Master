# Phase 0 — state audit

Branch: `feature/post-call-proposal` (off `main` — no `master` branch exists in this
repo, consistent with every prior session this month).

## Tier 0 — verify complete

### 1. Email auth — DONE, now actually committed
SPF/DKIM/DMARC all pass for `trevoadvisors.com` (`node scripts/check-email-auth.js`):
SPF `include:zohomail.com`, DKIM selector `zoho` (216-char key), DMARC `p=none` with
`rua=` collecting. **Gap found and closed**: the script itself existed on disk, fixed
and passing, but had never been `git add`ed on any branch all session — it was sitting
untracked in the working directory. Committed as this session's first commit.

### 2. Nora multi-channel + multi-offering — **NOT merged, contrary to the plan's assumption**
The plan states "merged. Confirm present, do not touch." Reality: Nora exists on local
branch `feature/nora-multichannel-config` (8 commits, complete, 46 tests passing per its
own `CHECKPOINT.md` section) but is **not merged to `main` and not pushed to origin**.
This branch (`feature/post-call-proposal`) was created off `main` per the plan's own
instruction, so **none of Nora's code is present here** — no `nora/` directory, no
call-logging, nothing to reference.

Consequence for the anchor task: Step 0's "where call outcomes/notes land — Nora logs..."
resolves to "nowhere, Nora logs don't exist on this branch." Using the plan's own
designed fallback: "if absent, define the minimal structured input." Proceeding on that
basis — see Tier 1 below.

**Recommendation, not actioned this session** (out of scope, flagging only): merge
`feature/nora-multichannel-config` to `main` before or alongside a future session, so
Nora's call-handling code and this proposal work live in the same tree.

## Tier 1 anchor — additional Step 0 discovery

### Call outcomes/notes location
Confirmed absent, matching the Nora finding above. `queue/*-brief.json`'s `diagnosis` /
`hero_angle` fields are **pre-call** diagnostic output (from Diagnoser, before any human
contact) — not post-call notes. No `call_notes`, `call_outcome`, `painPoint`, or similar
field exists anywhere in `scripts/*.js` or `state.json`. Building the minimal structured
input per the plan's fallback (see Tier 1, task 1).

### Stripe — **not live, contrary to the plan's assumption**
The plan states "Stripe and Cal.com are both confirmed live... Stripe is live — this
generates a real link... default it on since keys are confirmed." Reality, checked three
independent ways:
1. No `STRIPE_*` key of any kind in `.env.local` (full key-name grep against the file).
2. `website/checkout/index.html` still has placeholder Payment Link URLs —
   `https://buy.stripe.com/YOUR_WEBSITE_LINK_ID` (and `..._NORA_LINK_ID`,
   `..._ATLAS_LINK_ID`, `..._ARGUS_LINK_ID`) — never replaced with real ones.
3. `scripts/brief.js`'s own live blocker check (`if (checkoutHtml.includes('YOUR_WEBSITE_LINK_ID'))`)
   independently confirms this right now: running `node scripts/brief.js` prints
   `Stripe Payment Links not configured — checkout takes no payments yet`.

This is possibly a container-vs-Mac environment gap (`.env.local` is gitignored,
machine-local, and may hold real keys on Dave's Mac that never reach this container —
the same pattern documented throughout this repo's `CLAUDE.md` for other credentials).
Whatever the cause, this environment cannot generate a real live Stripe link today.

**Decision**: build the full Checkout Session integration against `STRIPE_SECRET_KEY`
(raw HTTPS to `api.stripe.com`, matching this repo's established convention of avoiding
SDK dependencies — see `pitcher.js`'s Twilio calls, `enricher.js`'s Apollo calls). The
code path is 100% real and ready. It **fails loud** with a clear message when
`STRIPE_SECRET_KEY` is unset, exactly like every other credentialed script in this repo
(`enricher.js`, `sheet-log.js`), rather than the plan's literal "default it on since keys
are confirmed" — that instruction doesn't hold given what Tier 0 actually found. Money-
path tests (task 5) cover everything that doesn't require a live key: package → correct
amount/line-item mapping, and the fail-loud-when-missing-key path itself.

### Cal.com — live, no discrepancy
`https://cal.com/david-hettinger-g8qbdk/30min` is a public booking page URL, not a
secret — no key needed to reference it. Used directly as the proposal's secondary CTA,
overridable via the existing `CALCOM_LINK` env var convention (`mobile.js`/`drip.js`
already do `process.env.CALCOM_LINK || <default>`) though `CALCOM_LINK` isn't currently
set in `.env.local` either.

### Zoho Drafts delivery mechanism
`ZOHO_EMAIL` / `ZOHO_APP_PASSWORD` are present in `.env.local` — real credentials
available. The plan references "the gap-reply agent already drafts this way" —
`scripts/reply-agent.js`, which lives on branch `claude/email-agent-scope-audit-ku4pkc`
(also unmerged, also not present on this branch). Rather than depend on a file that
doesn't exist here, the proposal delivery script reimplements the same
IMAP-append-to-Drafts pattern directly, using `nodemailer`'s `MailComposer` (already a
repo dependency) for correct MIME/header encoding instead of hand-rolling it, and
`imapflow` (already a repo dependency, already installed in `node_modules`) for the
IMAP connection + `Drafts` folder append.

### Existing `website/proposal/index.html` and `website/checkout/index.html`
Both already exist (28.7KB and 19.5KB respectively) — static marketing/checkout pages,
not generated per-lead. Not reused directly (this task needs a per-lead generated
proposal, not a static page) but checked for brand/style/copy conventions to match.

### Package/pricing figures
Confirmed against the plan's own numbers — no pricing data exists yet in code for
Growth/Pro tiers (`config/templates.json`, `website/checkout/index.html` etc. currently
only reference the flat $100 one-time website). Growth ($497 + $147/mo) and Pro ($797 +
$197/mo) are new to this session, defined fresh per the plan's own package list.

## Tier 3, item 6 (Funnel metrics) — **already DONE, on a separate unmerged branch**

The plan assumes "Phase 0 will find them not-started" and offers to build "just the
counter" if that's all that fits. Reality: the entire item — Apollo hit-rate counter
(additive to Enricher) **and** the full stage-by-stage conversion dashboard, read-only,
reading `state.json` + Sheets — was already built, tested (14 tests), and checkpointed
in a prior session on branch `feature/funnel-metrics` (7 commits, not merged, not
pushed). Per Phase 0's own rule ("Done → skip, note it, next item"), **not rebuilt**.

**Recommendation**: merge `feature/funnel-metrics` to `main` — it's finished and
independent of this session's work. Its dashboard also has a "deferred" open/click/pay
tracking hook that Tier 1b (this session) can now feed directly once both branches share
a tree.

## Everything else in the plan

Tier 2 (hygiene), remaining Tier 3 items (7–10), and the Backlog (Nora remediation,
DMARC tighten) are all confirmed not-started, matching the plan's own expectation —
proceeding through the queue in order per the capacity budget.
