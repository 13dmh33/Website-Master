# Funnel metrics — Step 0 discovery

Branch: `feature/funnel-metrics` (off `main` — this repo has no `master` branch; `main`
is the default and matches the "off master" intent, same as the prior Nora session).

## 1. Enricher — where Apollo returns, what counts as a hit

`scripts/enricher.js`. The single call site is `lookupEmail()` (line 228), which POSTs to
Apollo's `/v1/people/match` and returns either `{ email, email_status, name, title }` on a
match or `null` on no-match (422/404). The caller (`main()`, line 380) branches on
`result?.email`:

- **Hit** (`result.email` truthy): `updateLeadFile()` (no-website mode) or
  `moveHasWebsiteLeadToAuditorReady()` (has-website mode) — both already write
  `enriched_at`, `email_status`, `enriched_name`, `enriched_title` onto the lead record.
  `recordApollo(1, 'enricher')` and `cfg.credits_used++` fire **only in this branch** —
  confirms Apollo only bills a credit on a successful match, never on a miss.
- **Miss**: `markNoEmail()` / `markHasWebsiteNoEmail()` — writes only `enriched_at`, no
  credit charged.

**Enricher never touches `state.json` today** — no `require`, no read, no write. Its only
writes are `leads/*.json`, `leads-web/needs-email-*.json`, `leads-web/{basename}.json`,
`queue/*-brief.json` (channel upgrade), and its own `config/enricher-config.json`.

**Delta from the scope doc's field-casing:** every existing field this exact function
writes (`enriched_at`, `email_status`, `enriched_name`, `enriched_title`) is snake_case.
The scope doc specifies `apolloAttempted` / `apolloHit` / `apolloCreditSpent` in
camelCase. There's a mixed-casing precedent already: `state.json`'s queue entries mix
snake_case (`sent_at`, `diagnosed_at`) with two recent camelCase additions from
contact-scraper.js (`preScrapeStatus`, `scrapedEmailAt`). Following the doc's literal
field names as given (they read as specific, intentional identifiers, not placeholders) —
adds one more camelCase field to an otherwise snake_case object, same pattern already
tolerated elsewhere. Flagging, not blocking.

**Where the new fields land:** on the same lead record `updateLeadFile()` /
`markNoEmail()` / `moveHasWebsiteLeadToAuditorReady()` / `markHasWebsiteNoEmail()`
already write to (`leads/*.json` or `leads-web/*.json`), in the same write call —
**not** a new `state.json` write path. Enricher has never touched `state.json`; adding
one now would be a bigger structural change than the scope doc's "additive
instrumentation" framing implies, and isn't needed — the rollup script in Part 1 can read
`leads/*.json` / `leads-web/*.json` directly.

**Scoping "phone-only leads"**: the scope doc's business context literally says "Apollo's
email-discovery hit rate on phone-only leads." That maps exactly to Enricher's
`no-website` mode (leads with no website at all — genuinely phone-only). `has-website`
mode leads have a real site, just no scrapeable email — not "phone-only" in the literal
sense. Both modes get instrumented (both call Apollo, both are worth recording), but the
rollup's headline "phone-only hit rate" number filters to `no-website` mode only, and
says so.

## 2. state.json — real stage vocabulary

`state.json.queue[]` (645 entries today) is the master per-lead tracker, keyed by
`lead_id`. Live status counts today:

```
checked: 458   sent: 145   mockup_pending: 9   drip_d1_sent: 17   closed: 11
diagnosed: 2   drip_d1b_sent: 1   unsubscribed: 2
```

Grepping every `status =` / `status:` literal actually written across `scripts/*.js`
(not just what's live right now) gives the full real vocabulary:

`scouted → diagnosed → checked → mockup_pending/mockup_ready → sent →
drip_d1_sent → drip_d1b_sent → (drip_d1c_sent, drip_d2_sent by the same pattern,
none fired yet) → replied → hot → unresponsive / unsubscribed / closed`

**`replied` and `hot` are real, both currently at zero.** `webhook.js`'s
`updateState(leadId, 'replied')` fires on any non-STOP inbound SMS reply; `mobile.js`
sets `entry.status = 'hot'` (line 307) right after auto-sending the booking-slots reply.
Neither has ever fired in this data — 0 leads currently at either status, out of 163
that have received an initial send (145 `sent` + 18 in drip). That's a real, measured
number, not a guess — see funnel commit for the caveat (some of those sends are recent
enough that "no reply yet" and "the messaging doesn't work" aren't distinguishable yet).

**`closed` is not "deal won."** Read all 11 live `closed` entries — every single one has
a `closed_reason` and every reason is a data-quality rejection (`masked_email_not_deliverable`,
`bad_data_gmb_site_mismatch`, `wix_template_placeholder_email`,
`wrong_state_city_name_collision` ×6, `wrong_city_and_trade_bad_match`). **There is
currently no signal anywhere in the pipeline for an actual won deal / paying customer.**
`status: 'closed'` is never even set by any script — every occurrence found was a manual
closure (mine, this session, and presumably Dave's). The scope doc's hypothesized
`booked → closed` final stage doesn't have real data behind it yet; the dashboard has to
say so rather than silently rendering an 11-count "closed" bar that would read as 11 sales.

**`opened` does not exist.** Grepped for any email-open-tracking signal (pixel, open
rate, opens) across `scripts/*.js` and `config/*.json` — none. Pitcher sends via
Zoho SMTP / nodemailer with no tracking pixel. The scope doc's hypothesized
`scraped → enriched → contacted → opened → replied → booked → closed` funnel is adjusted
to drop `opened` (unmeasurable) and `booked` is relabeled to reflect what's actually
tracked (`hot`, i.e. "we auto-sent booking slots after a reply" — not "an appointment was
actually booked," which nothing in this pipeline confirms either).

**Two parallel per-lead trackers exist, not one.** `messages/{lead_id}-sent.json` (one
file per sent lead) has its own, richer status vocabulary — `positive` (webhook.js,
mirrors `state.json`'s `replied`), `booking_sent` (mobile.js, mirrors `hot`),
`unresponsive` (drip.js, mirrors `state.json`'s `unresponsive` exactly — same value,
both files), `unsubscribed` (mirrors exactly). Every transition that touches
`messages/*-sent.json` also writes an equivalent value to `state.json`'s queue — just
under different names for the reply/booking pair. **Confirms `state.json.queue[].status`
alone is sufficient as the funnel's stage source of truth** — `messages/*-sent.json` is
read as a secondary enrichment source (e.g. `reply_text`, `replies[]`) where useful, not
required for stage counts.

## 3. Google Sheets structure

`scripts/sheet-log.js` (from the prior session's work, unchanged this session) writes
three tabs via `scripts/lib/google-sheets.js`, service-account auth:

- **SentLog** (16 cols, A–P): company, email, trade, last send, date updated, status
  (user-editable, preserved), demo URL, email 1–4 sent dates, last reply date, reply
  summary, unsubscribed, unsubscribe date, notes (user-editable, preserved). Email-channel
  leads only.
- **AllContacts** (11 cols, A–K): company, trade, city, phone, email, website, channel,
  status, rating, reviews, demo URL. All channels, rebuilt from scratch each run.
- **ChangeLog**: append-only `timestamp | action | company | email | change`.

For the Apollo hit-rate rollup (Part 1), a new dedicated tab is the right home —
neither SentLog nor AllContacts has a natural "Apollo attempt" row shape, and per the
scope doc's own rule, existing tabs' user-editable columns (F, P) must stay untouched.

## 4. Existing event signals — consumed, not re-derived

Confirmed and reused directly, no re-derivation:

- **Replied**: `webhook.js` (SMS) sets `state.json` `replied` + `messages/*-sent.json`
  `positive`. No email-reply signal exists (`poller.js` is described in `CLAUDE.md` as
  the IMAP email-reply poller but only classifies/logs via `reply-classifier.js` — it
  does not currently write `replied` into `state.json` the way `webhook.js` does for
  SMS. This is a real, pre-existing gap in the pipeline, not something this session
  should fix — noting it because it means the funnel currently undercounts email replies
  specifically, and the dashboard should say so.)
- **Booking auto-reply sent**: `mobile.js` sets `hot` / `booking_sent`.
- **Unresponsive**: `drip.js`, after all drip steps exhausted with no reply.
- **Unsubscribed**: `webhook.js` (SMS STOP).

## Everything else in the scope doc holds as written

Read/log-only scope, additive-only state fields, Node/CommonJS (same delta as the Nora
session — repo is CommonJS throughout, not ESM; the scope doc's "Node.js / ESM, matching
the repo" is incorrect about the repo, corrected here same as before), and the explicit
out-of-scope list are all followed as specified.
