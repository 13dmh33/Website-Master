# Milly — setup guide

Milly is the Instagram content engine for Reeve, the speaker booking agency. It automatically generates and posts 3-4 pieces of content per week that attract emerging speakers to the Reeve brand.

This guide is written for non-technical operators. You do not need to understand the code to run Milly.

---

## What Milly does each week

**Monday morning** — Milly researches what's happening in the speaking industry (conferences, deadlines, trends) and writes 4 Instagram posts using that research.

**Tuesday through Sunday** — The 4 posts go live on Instagram at the scheduled times:
- Tuesday 7am — educational carousel (6 slides)
- Thursday 12pm — pain-point caption
- Saturday 9am — "Reeve found this" (real conference opportunities)
- Sunday 6pm — short reel script

**Sunday evening** — Milly checks which posts performed best and uses that data to write better content the following week.

---

## Before you start — one-time setup

### Step 1: Install software (if not done already)

You need Node.js version 18 or newer. Check if it's installed:

```
node --version
```

If you see a version number, you're good. If not, download Node.js at nodejs.org.

### Step 2: Install Milly's dependencies

Open a terminal in the `/milly` folder and run:

```
npm install
```

This takes about a minute. You'll see a lot of text scroll by — that's normal.

### Step 3: Set up your credentials

Copy the example credentials file:

```
cp .env.example .env
```

Open the new `.env` file and fill in the values. At minimum, you need:

```
ANTHROPIC_API_KEY=your_key_here
```

Get your Claude API key at console.anthropic.com → API keys.

If you want posts to publish automatically, also add your PostPeer credentials (see PostPeer section below).

### Step 4: Verify setup

Run this to check everything is configured:

```
node scripts/setup.js
```

It will tell you what's working and what's missing, in plain English.

### Step 5: Generate the evergreen content bank

Run this once to create backup posts Milly can use if research fails:

```
node scripts/generate-evergreen.js
```

---

## Connecting Instagram for automatic posting

### Convert to Instagram Business (free)

1. Open Instagram on your phone
2. Go to your profile → three lines (top right) → Settings and privacy
3. Scroll to Account type and tools → Switch to professional account
4. Select Business
5. Done. No Facebook account needed.

### Create a PostPeer account

1. Go to postpeer.dev and create a free account (20 posts/month free)
2. Connect your Instagram Business account in the PostPeer dashboard
3. Copy your API key and account ID from PostPeer settings
4. Add them to your `.env` file:
   ```
   POSTPEER_API_KEY=your_key
   POSTPEER_ACCOUNT_ID=your_account_id
   ```

---

## Running Milly

### Test run (no posting — just generates content locally)

```
node scripts/test-pipeline.js
```

After this runs, check `/output/queue/` for a preview HTML file. Open it in a browser to see the week's content before it goes live.

### Post everything in the queue manually

If PostPeer is not configured, or you want to review content before it posts, run:

```
node scripts/push-queue.js
```

### Run the full pipeline manually (skips GitHub Actions)

```
node agents/researcher.js
node agents/generator.js
node agents/designer.js
node agents/scheduler.js
```

---

## Reviewing content

All generated content is saved to the `/output/` folder:

- `/output/briefs/` — weekly research notes
- `/output/content/` — the actual post captions and carousel text
- `/output/images/` — the PNG images for each post
- `/output/queue/` — posts waiting to be published (includes a preview HTML file)
- `/output/archive/` — completed weeks and performance data

---

## Automatic scheduling (GitHub Actions)

Once you push the code to GitHub, Milly runs automatically:

- **Every Monday at 6am MT** — full pipeline (research → generate → design → schedule)
- **Every Sunday at 10pm MT** — analytics check (pulls Instagram data, updates what's working)

You don't need to do anything. Just make sure your GitHub repository has the right secrets set:

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add each variable from your `.env` file as a secret

---

## If something goes wrong

**Posts not appearing on Instagram**  
Check `/output/queue/` — if posts are there with status "pending," PostPeer isn't connected. Run `node scripts/push-queue.js` to post manually, then fix the PostPeer credentials.

**Content feels off-brand**  
Edit `templates/brand-voice.json`. The `avoid_words` list controls what Milly will never say. The `tone` field sets the overall voice.

**Research is always using backup content**  
That's normal if you don't have a SerpApi key. The backup content is just as good. To enable live research, get a free SerpApi key at serpapi.com and add `SERPAPI_KEY=your_key` to `.env`.

**Setup check shows errors**  
Run `node scripts/setup.js` again and read the error messages. Each one tells you exactly what to do.

---

## Getting help

Questions: dave@trevoadvisors.com  
Technical issues: check `/output/` for log files, or run `node scripts/setup.js` for a status check.
