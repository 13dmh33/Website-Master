# Nora multi-channel + multi-offering — Step 0 discovery

Branch: `feature/nora-multichannel-config` (off `main` — this repo has no `master` branch;
`main` is the default branch and matches the "off master" intent).

This document records what Step 0 actually found in the codebase, compared against what
the session scope document assumed. Two material deltas were found. Both are handled by
building the correct thing rather than forcing the doc's assumptions onto code that
doesn't exist.

## Delta 1: there is no existing Nora product implementation

The scope doc assumes: "Today Nora is single-channel (missed-call text-back) and
hardcoded for plumbers," and asks Step 2 to migrate "the existing plumber install" and
prove byte-identical output against it.

Grepped the full repo for `nora`, `missed.call`, `missed_call`, `text.back`, `cal.com`,
`calcom`. Nora exists in exactly three places, none of which are a customer-facing agent:

1. **`config/templates.json`** (line ~175) — a cold-outreach email template (`e6`) that
   pitches Nora as a sales talking point to prospects: *"Nora — our AI voice agent —
   answers calls, qualifies the job, and books the appointment while you're working."*
   This is copy for Dave's own outbound sales, not running code.
2. **`state.json` → `nora_pipeline`** (currently `[]`) — an array of
   `{ lead_id, nora_pitch_due, nora_pitched, nora_pitched_at }` records. This tracks when
   to pitch the Nora *upsell* to Dave's own converted website customers, 7 days after
   their site deal closes. It is not per-end-customer conversation state.
3. **`scripts/mobile.js` → `checkNoraPipeline()`** (+ `agents/mobile.md`) — reads
   `state.json.nora_pipeline` daily and auto-sends the upsell pitch message above to
   contractors who are due. This is real, working code — it stays untouched.

There is no missed-call webhook handler, no qualifying-question logic, no booking logic,
no Cal.com integration scoped to Nora, and no per-contractor Twilio number. The single
`CALCOM_LINK` / `TWILIO_*` env vars that exist are Dave's own, used for his own sales
calls and his own cold-outreach SMS (`scripts/mobile.js` booking replies,
`scripts/webhook.js` inbound reply handling) — single-tenant, not per-customer.

**Consequence:** Step 2's "byte-identical migration" proof has nothing to diff against.
Substituted with a spec-conformance check instead — the new config-driven core is built to
match the *sold* behavior (what `e6`'s copy and `agents/mobile.md` already promise
customers), verified by test, and documented as such in that commit. Flagging this rather
than inventing a fictional "before" state to migrate from.

**Consequence for architecture:** this session is a real *build*, not a refactor. The
three-layer (adapters / core / responders) architecture in the scope doc is followed
exactly as specified — it's just applied to new code rather than extracted from an
existing single-channel handler.

## Delta 2: repo convention is CommonJS, not ESM

The scope doc says "Node.js / ESM, matching the existing repo." The existing repo is
CommonJS throughout: every file in `scripts/` uses `require(...)` / `module.exports`,
`package.json` has no `"type": "module"`, and there is not a single `import`/`export`
statement anywhere in `scripts/`. `check-email-auth.js` (added earlier this session) is
the one `.mjs`-style exception and it prints a Node warning for it.

Tests use Node's built-in `node:test` + `node:assert/strict` (see
`scripts/test/scout-has-website.test.js`), run via `node --test`, no external framework.

**Consequence:** all new Nora files use CommonJS to match the real repo convention (per
the doc's own rule: "follow the real schema... do not force this doc's field names").

## Where Nora's own state and config live

`state.json`'s `queue` array is keyed by `lead_id` — Dave's own sales-pipeline prospects
(the contractors he's selling websites to). It is not a home for a contractor's
end-customers' call/text conversations with their deployed Nora agent — those are a
different entity entirely (one Trevo lead can, once converted, have many of *their own*
customers texting Nora). Storing per-conversation state in root `state.json` would
conflate Trevo's own CRM with a customer's runtime bot traffic and risks corrupting the
existing Sheets-log pipeline that reads that file's `queue` shape.

Decision: Nora gets its own state store under `nora/state/` (one JSON file per
`customerId`, additive-only within itself), not a new array bolted onto root
`state.json`. Field naming (`channel`, `offeringId`, `routingResolved`) still matches
what the scope doc specifies, just in the correct home. Root `state.json` is never
touched by any Nora code in this branch — "Google Sheets logging still works" is
trivially satisfied because nothing that feeds `sheet-log.js` is modified.

Nora's per-customer config (the `customerId` / `enabledChannels` / `offerings` object)
lives at `nora/config/customers/<customerId>.json`, loaded and validated by
`nora/config/load-config.js`. No existing config-file pattern in the repo does per-tenant
config (everything in `config/*.json` today is a single global settings file for Dave's
own pipeline), so this is new by necessity, not a deviation from an existing pattern.

## Twilio patterns reused

- Signature validation: `scripts/webhook.js`'s `validateTwilioSignature()` (HMAC-SHA1 over
  sorted params, timing-safe compare) — same approach reused in the new adapters.
- Outbound SMS send: `scripts/pitcher.js`'s `sendSms()` — raw HTTPS POST to
  `api.twilio.com`, not the `twilio` npm package (which is a listed dependency but unused
  in practice — matching actual usage, not the package list).
- Env vars: existing `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_PHONE` are
  Dave's own number, reused only for local/dev testing of the new adapters. Real
  multi-tenant deployments will need a per-customer `fromPhone`, which is why
  `offerings[].calendarId` sibling field `customerId`-scoped phone lives in the customer
  config, not env vars — env vars stay single-tenant infrastructure credentials
  (account SID/auth token), config carries the per-tenant phone number.

## Everything else in the scope doc holds as written

Config object shape, safety gates (`NORA_LIVE`, `SMS_LIVE`, `CHAT_LIVE`, `META_DM_LIVE`),
normalized message shape, state additions, and the out-of-scope list are all followed
as specified — no other deltas found.
