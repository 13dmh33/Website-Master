# Pitcher Agent

## Role
Send the approved cold message + mockup video to each lead via the right channel.
ONLY send after Checker has set checker_approved = true.

## Input
Read from /queue/{lead_id}-brief.json where checker_approved = true and status != "sent"
Read video URL from /mockups/{lead_id}-video.txt

## Output
Write to /messages/{lead_id}-sent.json

```json
{
  "lead_id": "",
  "business_name": "",
  "channel": "",
  "sent_at": "",
  "subject": "",
  "body": "",
  "video_url": "",
  "status": "sent | positive | negative | no_reply"
}
```

## Channel Routing
- **email** (plumbers, HVAC): Send via Resend or SendGrid
- **sms** (electricians, roofers): Send via Twilio
- **ig_dm** (handymen, painters): Manual send — flag for human
- **linkedin** (GCs, remodelers): Manual send — flag for human

## Message Assembly

**Email:**
Subject: `Quick question about [Business Name]'s website`
Body: [final_message from Checker]
P.S.: "Built a quick mockup of what a new site could look like — attached."
Attachment: video from /mockups/{lead_id}-video.txt

**SMS:**
Body: [final_message from Checker] + short URL to video

**IG DM / LinkedIn:**
Flag as "manual_send" — write message to /messages/{lead_id}-draft.txt
Human sends manually, then updates status to "sent"

## Reply Detection
Monitor for incoming replies. When a reply arrives:
- Positive signals: "interested", "tell me more", "how much", "let's talk", "yes", "sure", "call me"
- Negative signals: "not interested", "remove me", "stop", "no thanks"
- Update status field accordingly
- Flag positive replies for Mobile agent

## Rules
- Never send without checker_approved = true
- Max 30 messages per day across all channels
- Log every send to /messages/ immediately
- Update state.json daily_stats.messages_sent after each send

---

## Script: scripts/pitcher.js

### Usage
```bash
node scripts/pitcher.js --force              # send up to daily limit
node scripts/pitcher.js --limit 5 --force   # send up to 5 today
node scripts/pitcher.js --dry-run --force   # preview messages, send nothing
```

### Config: config/pitcher-config.json
```json
{
  "daily_limit": 30,
  "auto_run": false,
  "from_email": "outreach@yourdomain.com",
  "from_name": "Your Name",
  "sent_today": 0,
  "sent_this_month": 0,
  "total_sent": 0
}
```

Set `auto_run: true` to enable scheduled runs. Otherwise `--force` is required.

### Environment Variables
```
RESEND_API_KEY=          # required for email channel
RESEND_FROM_EMAIL=       # overrides from_email in config (optional)
TWILIO_ACCOUNT_SID=      # required for SMS channel
TWILIO_AUTH_TOKEN=       # required for SMS channel
TWILIO_FROM_PHONE=       # required for SMS channel (E.164 format)
```

### Outputs
- `messages/{lead_id}-sent.json` — full send record (channel, body, video_url, status)
- `messages/{lead_id}-draft.txt` — manual draft for ig_dm or linkedin
- `config/pitcher-config.json` — updated daily/monthly counts
- `state.json` — status updated: checked → sent or manual_pending
