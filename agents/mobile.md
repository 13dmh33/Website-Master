# Mobile Agent

## Role
Handle positive replies in real time. Draft responses, book Cal.com calls,
and wait for owner approval before sending anything.

Run on iPhone via Claude Code. Never send without explicit human "approve" tap.

## Trigger
A lead in /messages/ has status = "positive"

## Step 1 — Draft Response
```
Hey [Name]! Great to hear from you. I'd love to show you the full mockup
on a quick call — I have some spots this week. Does [Day] or [Day] work?
Should only take 15 minutes.
```
Pull available days from Cal.com. Match timezone to lead's city.

## Step 2 — Book Cal.com Slot
Use Cal.com MCP to find next available 15-minute slot.
Format: "Tuesday May 14 at 2pm MT" — always include timezone.

## Step 3 — Present to Owner
Show a summary card:
```
POSITIVE REPLY
--------------
Business: [name]
Trade: [trade]
City: [city]
Their reply: "[their message]"

YOUR DRAFT:
[draft response]

Cal.com link: [url]

[ APPROVE & SEND ]  [ EDIT ]  [ SKIP ]
```
Wait for owner action. Do not send until "APPROVE" is tapped.

## Step 4 — After Approval
- Send draft + Cal.com link via same channel they replied on
- Update /messages/{lead_id}-sent.json: status = "call_booked"
- Update state.json: move lead from active → hot queue

## Nora Upsell Follow-up
Check state.json nora_pipeline daily. If nora_pitch_due = today:
Draft Nora pitch (see CLAUDE.md for template) and present to owner for approval.

## Rules
- NEVER send anything without explicit owner approval
- If owner doesn't respond within 2 hours, send a push notification reminder
- Log all actions to /logs/{date}.log

---

## Script: scripts/mobile.js

### Usage
```bash
node scripts/mobile.js     # checks Nora pipeline + handles any positive replies
npm run mobile             # same via npm
```

### To trigger Mobile for a reply
When a lead replies positively, update their sent record manually:
```bash
# Edit messages/{lead_id}-sent.json — set:
"status": "positive",
"latest_reply": "their reply text here"
```
Then run `node scripts/mobile.js`. The script will present the draft and wait for your A/E/S input before sending anything.

### Cal.com integration
Set `CALCOM_LINK=https://cal.com/your-username/15min` in `.env.local`.
The link is appended to every booking draft. Without it, the script uses
3 suggested weekday slots (next 3 business days at 2pm).

### Nora upsell
Triggered automatically when `nora_pitch_due` matches today's date in `state.json`.
To schedule a Nora pitch after a deal closes, add to `state.json nora_pipeline`:
```json
{ "lead_id": "abc123", "nora_pitch_due": "2026-06-03", "nora_pitched": false }
```

### Outputs
- `messages/{lead_id}-sent.json` — status updated to "call_booked"
- `messages/{lead_id}-reply-draft.txt` — manual draft (ig_dm/linkedin or missing contact)
- `messages/{lead_id}-nora-draft.txt` — Nora pitch draft if manual channel
- `state.json` — lead moved to status "hot" in queue
- `logs/{date}.log` — all actions logged
