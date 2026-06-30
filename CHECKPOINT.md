# Reply Agent — CHECKPOINT

Documents `scripts/reply-agent.js` — gap-selling email drafting for inbound replies.

---

## Step 0 decision: Zoho Drafts vs local queue

**Decision: Local review queue (`messages/reply-drafts-queue.json`)**

Zoho Drafts via REST API requires:
- Registering a separate Zoho OAuth 2.0 client in the Zoho Developer Console
- An interactive browser authorization flow to get a refresh token
- Ongoing refresh-token management (stored + rotated)
- Fetching the Zoho account ID and Drafts folder ID before any write

None of this infrastructure exists in the codebase. The existing setup uses Zoho only via IMAP (imapflow) and SMTP (nodemailer), both with username + app-password — no OAuth tokens.

The local queue achieves the same review workflow: the daily digest email delivers every draft's full body inline, Dave reads it, copies the body into Zoho as a reply, and sends it himself. Same steps as opening a Zoho draft.

---

## How drafts are reviewed and sent

1. **Hourly**: agent polls IMAP, classifies replies, calls Claude, saves drafts to `messages/reply-drafts-queue.json`.
2. **Once per day** (first run with pending drafts): agent emails Dave a digest with every pending draft's full body.
3. **Immediately for hot leads** (high-confidence positive intent): agent sends a separate notification email on the same run that catches the reply.
4. **Dave reviews**: reads the digest or notification email, copies the body, opens Zoho, finds the thread, pastes and sends.
5. **Optionally**: after sending, Dave updates the Sheet status column (F) to `quoted`, `customer`, etc. The agent doesn't do this — only Dave can confirm the conversation progressed.

To view all pending drafts from the terminal: `node scripts/reply-agent.js --show-drafts`

---

## Hot-lead vs batched digest behavior

| Condition | Behavior |
|-----------|----------|
| `positive` intent + `high` keyword confidence | Immediate email notification on the same hourly run |
| Everything else (question, objection, neutral) | Queued; included in once-daily batched digest |
| `negative` or `stop` intent | No draft; Sheet status → `do not contact`; unsubscribe flag set |
| `auto_reply` intent | Silently skipped; no draft, no Sheet update |

The digest fires at most once per calendar day (tracked in `config/reply-agent-state.json → lastDigestSentAt`). It fires on the first hourly run of the day that has pending drafts — typically 4am. Replies arriving later the same day appear in the next day's digest or trigger a hot-lead alert if positive.

---

## Cron install (Mac)

Schedule: every hour from 4am through 7pm Mountain time.

```
0 4-19 * * * cd /path/to/Website-Master && /usr/local/bin/node scripts/reply-agent.js >> logs/reply-agent.log 2>&1
```

**To install**: `crontab -e` → paste the line above with the real path → save.

**DST note**: cron follows the Mac's system clock. Mountain Time shifts automatically between MST (UTC-7) and MDT (UTC-6) as long as the Mac's timezone is set to "Mountain Time (US & Canada)". No code change needed for daylight saving.

**Mac-asleep caveat**: cron only fires when the Mac is awake. A sleeping Mac silently misses that hour's run with no catch-up. To ensure reliable coverage, keep the Mac awake during the 4am–7pm window (`caffeinate -i` in a terminal, or set Display Sleep to Never in System Settings). Do not try to solve this in code — it's an OS-level constraint.

**Log file**: each run appends to `logs/reply-agent-{date}.log`. With 16 runs/day the log is fully auditable.

---

## Isolated cost budget

Reply-agent has its **own** cost cap, tracked in `config/reply-agent-config.json`, completely separate from Checker's $3/mo budget and Diagnoser's $5/mo budget.

Default cap: **$5/mo** (adjust `costCapMonthly`).

When the cap is hit, the agent stops making Claude calls for the rest of the month, continues to poll IMAP and log, and prints `COST CAP REACHED — drafting paused for the month.` in the log. The cap resets automatically on the first run of a new calendar month.

Costs are also recorded to the shared `config/cost-log.json` under the service tag `reply_agent` so they appear in the morning reporter's MTD cost section.

Empty runs (no new replies) cost **$0** — the IMAP poll is free and the keyword classifier is free. Claude is only called when a genuinely new, un-drafted reply needs a gap-selling response.

**Gap economics** (`avgJobValue`, `missRatePct`, `proofPoint` in config): fill these for concrete number-based cost framing in drafts. While null/empty, Claude uses qualitative language only and logs `INFO: gap economics unset — Claude will use qualitative framing`. The drafts still work; numbers make them stronger.

---

## Google Sheet status sync

### Auto-transitions (agent sets these automatically)

| Event | Sheet status set |
|-------|-----------------|
| Email reply received (any intent except opt-out/auto-reply) | `replied` |
| `stop` or `negative` intent detected | `do not contact` + unsubscribed=TRUE |
| Reply arrives before sheet-log.js ran (no row exists) | Creates new row, sets above status |

### Manual transitions (Dave sets by hand)

| Status | When |
|--------|------|
| `quoted` | After sending a price or proposal |
| `customer` | After deal closes / payment received |
| `lost` | After a genuine no, or cold after a quote |

The agent never sets `quoted`, `customer`, or `lost` — these are owner judgment calls.

### Status hierarchy — only upgrade, never downgrade

`sent` → `replied` → `quoted` → `customer`

`do not contact` is terminal. The agent never demotes `customer` or `do not contact` to a lower status, even if a new reply arrives.

### Notes column (P) — additive, never overwritten

The agent appends a terse timestamped line on every reply event, e.g.:
- `2026-06-30 replied, type assertive (low confidence), intent positive, draft queued`
- `2026-06-30 opt-out (stop), set do not contact`

Prior notes are always preserved. The trail is cumulative.

### Proposal for Dave: `can't reach` status

Consider adding a `can't reach` status (distinct from `lost`) for leads that never reply across the full drip sequence and are not opt-outs. `lost` implies an actual conversation that ended in a no; `can't reach` means the channel failed. Do not add this to the live vocabulary until Dave confirms — keeps the status set clean.

---

## Dedup — two layers (release-critical)

Dedup is load-bearing because the agent runs 16×/day. Without it, every run re-drafts the same inbox and burns both the queue and the cost cap.

**Layer 1 — IMAP message-ID set** (`config/reply-agent-state.json → processedMessageIds`): checked inside the IMAP fetch loop before any classification or API call. Updated in-memory and persisted to disk *before* the main processing loop begins, so a crash mid-processing won't cause re-drafts on the next run.

**Layer 2 — Draft queue scan** (`.some(d => d.messageId === messageId)`): secondary check in case the state file was manually reset or corrupted. If a draft for that message-ID already exists in the queue, skip silently.

**Own-email guard**: if the `From:` address matches `ZOHO_EMAIL`, the message is skipped immediately (prevents processing Zoho's own reflected mail or delivery notifications).

**Verifying dedup across two consecutive runs**: run the agent once, note the count of processed IDs in `config/reply-agent-state.json`. Run again immediately. The second run should report `0 new replies to process` and the processed ID count should be unchanged. This verifies both layers are working.

---

## Thread state (multi-touch)

When Claude drafts a reply, the prior exchange history is written to `messages/{leadId}-sent.json` under the `reply_thread` array (additive — existing sent.json fields are preserved):

```json
"reply_thread": [
  {
    "messageId": "...",
    "receivedAt": "...",
    "intent": "question",
    "bodySnippet": "first 200 chars of their reply (quoted lines stripped)",
    "agentDraftId": "leadId_timestamp",
    "agentDraftSnippet": "first 200 chars of the agent's draft"
  }
]
```

On the next reply from the same lead, `loadThread(leadId)` returns this history and the last 3 exchanges are included in the Claude prompt. This means Claude knows the conversation history and can draft a response that continues the thread rather than restarting from zero.

---

## Overlap with mobile.js

`mobile.js` handles `status === 'positive'` replies by sending a booking response (calendar slots + /start link) immediately. `reply-agent.js` independently drafts a gap-selling reply for the same reply.

**These serve different purposes and are not in conflict:**
- `mobile.js` → fires the immediate slot-offer reply (already built, already working)
- `reply-agent.js` → drafts a gap-selling conversation response for Dave's review

Dave will receive two things for a hot lead:
1. mobile.js auto-sends the slot offer
2. reply-agent puts a gap-selling draft in the queue

Dave decides whether to also send the gap-selling draft (if the slot offer didn't get a response, or to deepen the conversation). This is documented here so Dave isn't confused by the dual behavior. No code change is needed to either script to handle this overlap.

---

## Edit-diff logging (path to graduation)

Every draft in `messages/reply-drafts-queue.json` stores:
- `agentDraftedVersion`: the exact body Claude wrote (immutable, never updated)
- `sentVersion`: placeholder for Dave to optionally paste what he actually sent

Over time, comparing `agentDraftedVersion` vs `sentVersion` across many sends reveals how much Dave edits the agent's drafts, which types and intents he edits most, and whether the gap-selling framing lands without changes.

**This edit history is the evidence base for ever turning on `autoSend`.** Without it, graduation is a guess. When the edit rate on a specific bucket (e.g., positive + assertive + high-confidence) drops to near zero over 30+ sends, that bucket may be a candidate for auto-send. Until then, `autoSend: false`.

To record a sent version: after Dave sends an email, he can paste the final body into the `sentVersion` field in the queue JSON. This is optional but valuable for building the evidence base.

---

## Graduation scope (future — do NOT enable in this session)

Two-phase path, all gated by `autoSend: true` in config (currently false):

**Phase 1 — Green-light bucket (eligible for auto-send):**
- High keyword classification confidence (`high`)
- Routine intents: `positive`, `question`
- High personality type confidence (`high`)
- Sufficient edit-diff history showing near-zero edits for this bucket

**Always manual, even after full graduation:**
- `stop` / `negative` / `objection` intents (already no-draft)
- Low personality type confidence (`low`)
- Any reply containing legal language, pricing negotiation, complaints, or anger
- Anything the keyword classifier flags as `neutral`
- First reply from any new lead (always review first contact)

**Rationale**: domain reputation for trevoadvisors.com is new. One bad autonomous send to a buyer cannot be recalled. Gate the risky slice, let the routine slice auto-send only after the edit-diff history earns it.

---

## Files created

| File | Purpose |
|------|---------|
| `scripts/reply-agent.js` | Main agent script |
| `config/reply-agent-config.json` | Config + cost cap + gap economics (Dave fills) |
| `config/reply-agent-state.json` | Auto-created on first run; stores processed IDs + digest timestamp |
| `messages/reply-drafts-queue.json` | Auto-created on first run; stores all drafts |
| `logs/reply-agent-{date}.log` | Auto-created per day; 16 runs/day are auditable |

## Files NOT modified

`mobile.js`, `reply-classifier.js`, `poller.js`, `checker.js`, `diagnoser.js`, `reporter.js`, `state.json` — zero changes to existing pipeline files.

---

## Known limitations

- **`sentVersion` not auto-populated**: Dave must manually paste sent text into the queue JSON for edit-diff logging. A future Zoho API integration (OAuth) could capture sent mail automatically.
- **Digest timing**: the daily digest fires on the first hourly run of the day that has pending drafts (typically 4am). Replies arriving after that run appear in the next day's digest unless they trigger a hot-lead alert.
- **No Zoho Drafts**: drafts live in a local JSON queue, not in Dave's Zoho Drafts folder. See Step 0 above for the reason. A future phase could add Zoho OAuth.
- **Body extraction**: the agent strips quoted lines by removing `>` prefixes and `On ... wrote:` headers. Unusual MIME structures (multipart/alternative with only HTML) may result in an empty body snippet; in that case Claude classifies from the subject line alone and notes this in the draft.
- **Sheet must be initialized first**: reply-agent creates new Sheet rows when needed, but the `SentLog` tab must exist (created by running `node scripts/sheet-log.js` at least once). If the tab doesn't exist, Sheet updates are silently skipped.

---

## How Dave runs it

```bash
# Check what's pending without running a poll
node scripts/reply-agent.js --show-drafts

# Preview a run (no API calls, no writes, no emails)
node scripts/reply-agent.js --dry-run

# Normal run (poll + draft + notify)
node scripts/reply-agent.js

# Install cron (edit path first)
crontab -e
# Add: 0 4-19 * * * cd /path/to/Website-Master && /usr/local/bin/node scripts/reply-agent.js >> logs/reply-agent.log 2>&1
```

**After receiving the daily digest**: open Zoho → find the prospect's thread → paste the draft body → send. Done. Do not hit Reply in the digest email — that sends to yourself.
