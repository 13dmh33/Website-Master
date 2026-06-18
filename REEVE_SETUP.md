# Reeve setup

Reeve's DM qualifier needs a Meta (Facebook/Instagram) App and a public
deployment before it can receive real DMs. Everything else — qualification
logic, scoring, routing — already works and can be verified locally first.

## 1. Test the qualification flow locally (no Meta App needed)

```bash
cd reeve
npm install
node agents/dm-agent.js --simulate
```

This runs a mock conversation through all 3 questions and prints the
routed tier (high/mid/scout/low). Confirms the qualifier and scoring logic
work before touching any Meta setup.

## 2. Meta App registration

1. Go to `developers.facebook.com` → Create App → choose "Business"
2. Add product: **Instagram** → Messenger
3. Add product: **Webhooks**
4. App Settings → Basic → copy the **App Secret** → this is `META_APP_SECRET`
5. Set the app to Live mode (Development mode only delivers events from
   test accounts — DMs from real followers won't arrive)

## 3. Connect the Instagram Business account

1. Connect `@reeve.agency` (Instagram Business account) to the Facebook App
2. Generate a Page Access Token with `instagram_manage_messages` +
   `pages_messaging` permissions → this is `META_PAGE_ACCESS_TOKEN`
3. Copy the numeric Page ID → this is `INSTAGRAM_PAGE_ID`

## 4. Local webhook testing before deploy

```bash
cd reeve
cp .env.example .env   # fill in META_VERIFY_TOKEN, META_APP_SECRET, META_PAGE_ACCESS_TOKEN, INSTAGRAM_PAGE_ID, ANTHROPIC_API_KEY
node agents/dm-agent.js
```

In a second terminal:

```bash
npx ngrok http 3000
```

Use the printed `https://xxxx.ngrok.io` URL as the webhook callback URL in
the Facebook App dashboard (step 6 below) to test the verification
handshake and a real DM before deploying to Railway.

## 5. Deploy to Railway

1. `railway init` inside `reeve/`
2. Set all required env vars in the Railway dashboard:
   `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`,
   `INSTAGRAM_PAGE_ID`, `ANTHROPIC_API_KEY`
   plus optional: `DAVE_NOTIFY_EMAIL`, `ZOHO_EMAIL`, `ZOHO_APP_PASSWORD`,
   `CALL_BOOKING_LINK`
3. `railway up`
4. Copy the generated Railway URL (e.g. `https://reeve-dm.up.railway.app`)

## 6. Register the webhook with Meta

1. Facebook App → Webhooks → subscribe to the `messages` field on the
   `instagram` object
2. Callback URL: `https://<your-railway-url>/webhook`
3. Verify token: same string as `META_VERIFY_TOKEN`
4. Click Verify — Meta calls `GET /webhook`, and dm-agent.js responds with
   the challenge

## 7. Cal.com link for high-tier auto-booking

1. Create a 20-minute "Reeve Discovery" event at cal.com
2. Copy the booking URL → set as `CALL_BOOKING_LINK` in Railway
3. This is the link automatically sent to `high`-tier leads in the
   `high_fit` message (see `reeve/templates/qualification.json`)
4. Falls back to `https://cal.com/david-hettinger-g8qbdk/30min` if unset —
   confirm this is the right link for Reeve specifically (it's currently
   shared with Trevo's main booking flow) before going live

## 8. Final check

```bash
curl https://<your-railway-url>/health
```

Should return pipeline stats. Then send a real "stages" DM to
@reeve.agency from a test Instagram account and confirm the qualification
flow runs end to end.
