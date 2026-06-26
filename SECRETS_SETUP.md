# Secrets Setup — One-Sitting Deployment Guide

Complete these steps once to activate automated Milly posts and GitHub Actions workflows.
Estimated time: 20–30 minutes.

---

## 1. Buffer Classic Access Token (required for Milly scheduling)

Buffer API v1 requires a **classic access token**, not the OIDC token from the Buffer MCP page.

1. Go to [buffer.com/developers](https://buffer.com/developers)
2. Click **Create App** → fill in any name/URL → save
3. Under your app, click **Generate Access Token**
4. Copy the token — it starts with `1/`

**Add to `milly/.env`:**
```
BUFFER_ACCESS_TOKEN=1/xxxxxxxxxxxxxxxxx
```

---

## 2. Buffer Instagram Profile ID

Once you have the access token:

```bash
curl "https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN"
```

Find the object where `service` is `instagram`. Copy its `id` value (looks like `56e05e...`).

**Add to `milly/.env`:**
```
BUFFER_INSTAGRAM_PROFILE_ID=56e05exxxxxxxxxxxxxxxxx
```

---

## 3. GitHub Actions Secrets

Go to: **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret Name | Value | Required? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-api03-...`) | **Required** |
| `BUFFER_ACCESS_TOKEN` | Classic Buffer token from Step 1 | **Required** |
| `BUFFER_INSTAGRAM_PROFILE_ID` | Profile ID from Step 2 | **Required** |
| `SERPAPI_KEY` | SerpApi key for live research | Optional (evergreen fallback if missing) |
| `UNSPLASH_ACCESS_KEY` | Unsplash API key for editorial photos | Optional (gradient fallback if missing) |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram Graph API token (read-only) | Optional (analytics only) |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Numeric IG business account ID | Optional (analytics only) |

---

## 4. Activate GitHub Actions

The workflows are in `.github/workflows/` and are already configured. They will **only trigger from the `main` branch.**

To activate:
1. Complete steps 1–3 above
2. Review the content on `claude/milly-content-engine-qZme3`
3. Merge `claude/milly-content-engine-qZme3` → `main`
4. Workflows activate automatically on the next scheduled run

**Scheduled runs:**
- `milly-weekly-pipeline.yml` — Monday 6am MDT (generates + schedules 4 posts)
- `milly-weekly-analytics.yml` — Sunday 10pm MDT (reads Instagram engagement, updates brand voice)

**Manual test run:**
Go to **GitHub → Actions → Milly weekly pipeline → Run workflow** to trigger immediately.

---

## 5. Trevo — Mac-Only Setup

These scripts must run on your Mac (blocked from container):

```bash
# Install IMAP library
npm install imapflow

# Start SMS webhook + expose via ngrok
node scripts/webhook.js &
ngrok http 3000
# → copy the ngrok URL → paste into Twilio console as webhook for incoming SMS

# Start email poller
node scripts/poller.js

# Morning report (or set as cron at 7am)
node scripts/reporter.js
```

**Cron for reporter (7am daily):**
```
0 7 * * * cd /path/to/Website-Master && node scripts/reporter.js >> /tmp/reporter.log 2>&1
```

**Add to `.env.local` (root level):**
```
SITE_START_URL=https://trevoadvisors.com/start/
TWILIO_WEBHOOK_SECRET=   # same value as TWILIO_AUTH_TOKEN
```

---

## 6. Stripe Payment Links

Create two payment links at [dashboard.stripe.com](https://dashboard.stripe.com) → Products → Payment Links:
- **Website only**: $100 one-time, no monthly fee
- **Website + Nora**: $100 one-time + $65/mo

Paste link IDs into `website/checkout/index.html`:
- Replace `YOUR_WEBSITE_LINK_ID` with the website-only link ID
- Replace `YOUR_NORA_LINK_ID` with the Nora bundle link ID

---

## 7. Formspree (intake form)

1. Create account at [formspree.io](https://formspree.io)
2. Create a new form → copy the form ID (looks like `xpzgdokq`)
3. Paste into `website/intake/index.html` replacing `YOUR_FORM_ID`

---

## 8. Reeve — Railway Deploy

Once the Meta App is approved and Reeve is ready to go live:

```bash
cd reeve
railway init
railway up
```

Set environment variables in Railway dashboard:
- `ANTHROPIC_API_KEY`
- `META_VERIFY_TOKEN` (any string you choose)
- `META_APP_SECRET`
- `META_PAGE_ACCESS_TOKEN`
- `DAVE_NOTIFY_EMAIL`
- `CALCOM_LINK`

Then register the Railway deploy URL in Meta App → Webhooks → Instagram → Callback URL.

---

## Status Checklist

- [ ] Buffer classic token in milly/.env
- [ ] Buffer Instagram profile ID in milly/.env
- [ ] GitHub Actions secrets added (7 secrets)
- [ ] Branch merged to main → workflows active
- [ ] Stripe payment links created and pasted into checkout page
- [ ] Formspree form ID pasted into intake page
- [ ] Demo site deployed to trevoadvisors.com
- [ ] webhook.js + ngrok running on Mac, URL registered in Twilio
- [ ] imapflow installed, poller.js running
- [ ] SITE_START_URL added to .env.local
- [ ] Reporter cron set at 7am
