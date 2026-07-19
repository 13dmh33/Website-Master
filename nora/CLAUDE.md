# Nora — AI scheduling / call-capture agent product

**Directory:** `/nora`
**See also:** `/DISCOVERY.md` (Step 0 findings from the multi-channel/multi-offering
build session) and `/CHECKPOINT.md` if present (session handoff state).

Nora is a product Trevo Advisors sells to home service contractors — an AI agent that
answers missed calls and texts, qualifies the job, and books an appointment. This is
distinct from `scripts/` at the repo root, which is Dave's own outbound sales pipeline
for acquiring those contractors as customers in the first place. `scripts/mobile.js`'s
`nora_pipeline` (in root `state.json`) only tracks *when to pitch the Nora upsell* to a
converted website customer — it is not Nora's runtime.

## Status (as of this session)

Config-driven core built from scratch — no prior Nora runtime code existed (see
`/DISCOVERY.md`). Missed-call text-back and two-way inbound SMS are implemented and
tested; web chat and Meta DM are scaffolded (empty adapter/responder stubs) only.

**Nothing is live.** `NORA_LIVE` (master) and `SMS_LIVE` (SMS-specific) both default off —
every outbound send becomes a draft file under `nora/state/drafts/<customerId>/` instead
of a real Twilio API call. Inbound webhooks are still fully processed and logged even with
gates off, so nothing is lost while waiting on Twilio A2P 10DLC to clear.

## Architecture

Three layers, per the session scope doc:

- **`channels/<name>/adapter.js`** — translates a channel's raw inbound payload into the
  normalized message shape (`lib/normalize.js`). Only channel-specific code lives here.
- **`core/`** — channel- and offering-agnostic. `core/index.js`'s `decide()` is a pure
  function `(message, config, conversation) -> { conversation, decision }`, no I/O, directly
  unit-testable. Priority order every turn: escalate > route (if multi-offering and
  unresolved) > qualify > book.
- **`channels/<name>/responder.js`** — formats a decision into that channel's outbound
  format and sends it through `lib/dispatch.js`'s `dispatchOutbound()`, which is the single
  gate choke point (draft when off, real send when on).

Adding a channel later is one adapter + one responder file — zero changes to `core/`.

## Config

One JSON file per customer at `nora/config/customers/<customerId>.json`, loaded and
validated by `nora/config/load-config.js` (`validateConfig()` in `nora/config/schema.js`
fails loud on anything malformed — never silently defaults). Two documented examples:
`example-plumber-single.json` (single offering — the reference/default-behavior install)
and `example-plumbing-hvac-two-offering.json` (multi-offering routing example).

## State

`nora/state/conversations/<customerId>/<conversationId>.json` — one file per conversation,
additive-only, gitignored (contains customer PII once live). `conversationId` is the
caller/texter's phone number, so a missed-call text-back and the customer's SMS reply to
it land in the same conversation. Deliberately **not** stored in root `state.json` — see
`/DISCOVERY.md` for why.

## Running it

```bash
npm run nora:test      # node --test nora/test/*.test.js
npm run nora:server    # node nora/server.js — webhook server, see server.js header for
                        # ngrok/Twilio console setup instructions
```

Env vars (dev/test, single Nora-managed number — see `.env.local`):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_PHONE`, `NORA_PORT` (default 3100),
`NORA_LIVE`, `SMS_LIVE`.

## Out of scope this session (do not build without a new scope doc)

- Web chat widget adapter (P1 next) — `channels/web_chat/` stubs only.
- Meta DM adapter (P2, blocked on Meta app review) — `channels/meta_dm/` stubs only.
- Any real Cal.com API integration — booking is always a draft-style confirmation
  referencing `offerings[].calendarId`, never a live booking call.
- Per-customer Twilio numbers — all customers currently share the dev/test
  `TWILIO_FROM_PHONE` in `.env.local`; production needs a `fromPhone` per customer config.
