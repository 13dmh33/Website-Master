# Webhook setup (under 5 minutes)

Twilio inbound SMS replies are handled by `scripts/webhook.js`. It must run on Mac
(needs a public URL) and validates every request against Twilio's HMAC-SHA1
signature spec — confirmed correct against the official spec on 2026-06-18.

## Steps

1. Install ngrok (one-time):
   ```
   npm install -g ngrok
   ```

2. Start the webhook server:
   ```
   node scripts/webhook.js
   ```
   Default port 3000. Override with `WEBHOOK_PORT=` in `.env.local`.

3. In a second terminal tab, expose it publicly:
   ```
   ngrok http 3000
   ```
   Copy the `https://xxxx.ngrok.io` URL it prints.

4. Register the URL in Twilio:
   - Twilio Console → Phone Numbers → your number → Messaging
   - "A message comes in" → Webhook → paste `https://xxxx.ngrok.io/twilio/reply`
   - Save

5. Verify it's alive:
   ```
   curl https://xxxx.ngrok.io/health
   ```
   Should return `{"status":"ok","timestamp":"..."}`.

6. Leave both terminal tabs running. Closing either one breaks inbound reply handling.

## Notes

- `TWILIO_AUTH_TOKEN` in `.env.local` must match the auth token for the Twilio
  account that owns the number — used to validate the `X-Twilio-Signature` header.
- Requests with an invalid signature are rejected with 403 and logged.
- ngrok's free tier rotates the URL every restart — re-paste it into Twilio
  each time you restart ngrok.
- Logs: `logs/webhook-YYYY-MM-DD.log`
