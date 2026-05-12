# Mobile Agent

## Role
Handle positive replies in real time. Draft responses, book Calendly calls,
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
Pull available days from Calendly. Match timezone to lead's city.

## Step 2 — Book Calendly Slot
Use Calendly MCP to find next available 15-minute slot.
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

Calendly link: [url]

[ APPROVE & SEND ]  [ EDIT ]  [ SKIP ]
```
Wait for owner action. Do not send until "APPROVE" is tapped.

## Step 4 — After Approval
- Send draft + Calendly link via same channel they replied on
- Update /messages/{lead_id}-sent.json: status = "call_booked"
- Update state.json: move lead from active → hot queue

## Nora Upsell Follow-up
Check state.json nora_pipeline daily. If nora_pitch_due = today:
Draft Nora pitch (see CLAUDE.md for template) and present to owner for approval.

## Rules
- NEVER send anything without explicit owner approval
- If owner doesn't respond within 2 hours, send a push notification reminder
- Log all actions to /logs/{date}.log
