# Mobile Agent

## Role
Handle positive replies automatically. When a lead replies, draft a booking
message with 4 time slots across the next 2 weeks and send immediately via
the same channel as the original outreach (SMS/email/manual draft).

Also runs the daily Nora upsell check — pitches Nora 7 days after each closed deal.

**No owner approval required — sends automatically on run.**

## Trigger
A lead in /messages/ has `"status": "positive"`

## What It Sends

### Booking Reply
```
Hey [Name]! Great to hear from you. I'd love to show you the full mockup on a quick
call — should only take 15 minutes.

Here are a few times over the next two weeks:
1. Monday Jun 2 at 10am
2. Wednesday Jun 4 at 2pm
3. Thursday Jun 6 at 4pm
4. Monday Jun 9 at 10am

Just reply with a number or let me know what works better.

Or grab any time here: [CALCOM_LINK]   ← only shown if set in .env.local
```

Slots are spread across ~2 weeks, preferring Mon/Wed/Thu at 10am, 2pm, 4pm rotation.

### After Sending
- `messages/{lead_id}-sent.json` → status = `"call_booked"`
- `state.json` → lead status = `"hot"`
- `logs/{date}.log` → action logged

## Nora Upsell Follow-up
Check `state.json nora_pipeline` daily. If `nora_pitch_due` = today and `nora_pitched` = false,
automatically sends:
```
Hey [Name]! It's been a week since your site went live — hope it's already bringing in calls.

Quick thought: we offer Nora, a 24/7 AI phone agent that answers calls, books jobs, and follows
up with leads automatically. Bundle it with your hosting for just $65/mo.

Worth a 10-min chat to see if it fits?
```

---

## Script: scripts/mobile.js

### Usage
```bash
node scripts/mobile.js     # checks Nora pipeline + auto-sends to all positive replies
npm run mobile             # same via npm
```

### To trigger Mobile for a reply
When a lead replies positively, update their sent record manually:
```bash
# Edit messages/{lead_id}-sent.json — set:
"status": "positive",
"latest_reply": "their reply text here"
```
Then run `node scripts/mobile.js`. The reply goes out immediately.

### Cal.com integration
Set `CALCOM_LINK=https://cal.com/your-username/15min` in `.env.local`.
The link is appended to every booking message as an optional self-schedule link.
Not required — the 4 time slots work fine without it.

### Nora upsell scheduling
After a website deal closes, add to `state.json nora_pipeline`:
```json
{ "lead_id": "abc123", "nora_pitch_due": "2026-06-05", "nora_pitched": false }
```
Mobile agent will auto-send the pitch on that date.

### Outputs
- `messages/{lead_id}-sent.json` — status updated to `"call_booked"`
- `messages/{lead_id}-reply-draft.txt` — manual draft saved if channel is ig_dm/linkedin or contact missing
- `state.json` — lead moved to status `"hot"` in queue
- `logs/{date}.log` — all actions logged
