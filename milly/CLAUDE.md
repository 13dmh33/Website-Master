# Milly — Claude Code session context

## What Milly is

Milly is the automated Instagram content engine for the Reeve speaker booking agency. It runs a weekly pipeline that researches speaking industry topics, generates 4 Instagram posts (carousel, caption, "Reeve found this," and a reel script), renders branded images, and schedules them via PostPeer or saves them to a manual queue.

Milly is internal. It is never customer-facing. The Instagram account it posts to (@reeve.agency) is the Reeve brand account — no human persona attached.

## Business flywheel

```
Milly posts 3-4x/week on Instagram
  → emerging speakers find the content
  → they follow or engage
  → Reeve's DM agent detects engagement
  → sends warm qualifier DM
  → speaker fills onboarding form
  → becomes paying Reeve client ($597–$997/mo retainer)
```

Every post is a lead gen asset. Every piece of content exists to make an emerging speaker feel the pain of missed stage opportunities and think "I need Reeve."

## Repo structure

```
/Website-Master           ← main repo (Trevo Advisors system)
  /milly                  ← all Milly code (this directory)
    CLAUDE.md             ← you are here
    README.md             ← plain English setup guide
    package.json
    .env.example
    /agents               ← autonomous agents (one job each)
      researcher.js       ← weekly research brief
      generator.js        ← brief → 4 content pieces via Claude API
      designer.js         ← content → PNG images via skia-canvas
      scheduler.js        ← content + images → PostPeer or queue
      analyst.js          ← Instagram insights → performance feedback
    /lib                  ← shared utilities
      claude.js           ← Claude API wrapper
      store.js            ← data persistence abstraction (JSON today, Airtable later)
      postpeer.js         ← PostPeer API helpers
      instagram-insights.js ← Instagram Graph API read-only
      canvas-render.js    ← skia-canvas image generation helpers
    /templates
      brand-voice.json    ← Milly's voice config, updated by analyst weekly
      evergreen.json      ← 10+ backup posts for slow research weeks
      post-formats.json   ← format specs, weekly niche rotation counter
    /cron
      weekly-pipeline.yml ← GitHub Actions: Monday 6am MT
      weekly-analytics.yml ← GitHub Actions: Sunday 10pm MT
    /output               ← all generated content lives here
      /briefs             ← weekly research briefs
      /content            ← generated content batches
      /images             ← rendered PNGs
      /queue              ← posts pending manual push
      /archive            ← completed weeks + analytics
    /scripts
      setup.js            ← validate env vars
      push-queue.js       ← manually post everything in /queue
      test-pipeline.js    ← dry run: full pipeline, no posting
      generate-evergreen.js ← one-time: generate 10 evergreen posts
  /reeve                  ← future Reeve agent code (placeholder only)
```

## Branch strategy

- All development on feature branches: `feature/[name]`
- Never commit directly to main
- Current active branch: `claude/milly-content-engine-qZme3`
- Merge to main only after Dave reviews and approves

## Agent roster

| Agent | File | Trigger | Job |
|-------|------|---------|-----|
| Researcher | agents/researcher.js | Mon 6am MT | Searches for speaking industry angles and conference deadlines. Falls back to evergreen if live search fails. |
| Generator | agents/generator.js | Mon 8am MT | Reads latest brief, makes 4 separate Claude API calls to create carousel, caption, "Reeve found this," and reel content. |
| Designer | agents/designer.js | Mon 9am MT | Renders PNG images for each post using skia-canvas. Dark navy + teal design. |
| Scheduler | agents/scheduler.js | Tue 6am MT | Sends 4 posts to PostPeer for scheduled publishing, or saves to /output/queue/ if PostPeer not configured. |
| Analyst | agents/analyst.js | Sun 10pm MT | Reads Instagram engagement data, updates brand-voice.json with what's working. |

## How to run each agent manually

```bash
cd milly

# validate environment first
node scripts/setup.js

# run full pipeline in test mode (no posting, outputs locally)
node scripts/test-pipeline.js

# run individual agents
node agents/researcher.js
node agents/generator.js
node agents/designer.js
node agents/scheduler.js
node agents/analyst.js

# post everything in the manual queue
node scripts/push-queue.js
```

## The store.js abstraction pattern

All agents read and write data through `lib/store.js`. No agent ever calls `fs` directly or touches Airtable directly.

Why this matters: when you swap from local JSON files to Airtable, you only change `store.js`. The agents don't change at all.

Current backend: local JSON files in `/output/`  
Future backend: replace `readJson`/`writeJson` internals with Airtable API calls. The exported function signatures stay identical.

```javascript
// agents do this:
const store = require('../lib/store');
const brief = store.getLatestBrief();
store.saveBrief({ weekOf: '2026-06-09', ... });

// agents never do this:
const fs = require('fs');
const brief = JSON.parse(fs.readFileSync('./output/briefs/brief-2026-06-09.json'));
```

## How to add a new evergreen post

1. Open `templates/evergreen.json`
2. Add a new entry to the `posts` array:
   ```json
   {
     "id": "ev-11",
     "niche": "booking | automation | mindset",
     "format": "carousel | caption | reevefound | reel",
     "hook": "opening line that stops a speaker mid-scroll",
     "body": "the full post body",
     "hashtags": ["#publicspeaking", "#speakerlife"],
     "used": false,
     "lastUsed": null
   }
   ```
3. Done. Researcher will pick it up automatically when live research fails.

Alternatively, run `node scripts/generate-evergreen.js` to generate a fresh batch via Claude API.

## How to update brand voice config

Edit `templates/brand-voice.json` directly. Key fields:

- `avoid_words` — words Milly will never use in generated content
- `what_works` — rolling 8-week record of top-performing formats (written by analyst)
- `top_hashtags` — rolling 8-week top performers (written by analyst)
- `visual_hypothesis` — current design hypothesis for the image aesthetic

The analyst updates `what_works`, `top_hashtags`, and `last_updated` automatically after each weekly review.

## How to onboard a new Instagram account

1. Convert the Instagram account to Business (free — done in the Instagram app under Account settings)
2. Create a PostPeer account at postpeer.dev and connect the Instagram Business account
3. Copy the PostPeer API key and account ID from the PostPeer dashboard
4. Add to `.env`:
   ```
   POSTPEER_ACCOUNT_ID=your_account_id_here
   POSTPEER_API_KEY=your_api_key_here
   INSTAGRAM_HANDLE=@your.handle
   ```
5. Run `node scripts/setup.js` to confirm everything is connected
6. Run `node scripts/test-pipeline.js` to generate a week's content in dry-run mode
7. Review `/output/queue/preview-[date].html` in a browser
8. If the content looks right, run `node agents/scheduler.js` to schedule it live

## Common failure modes and fixes

**Researcher fails with network error**  
Researcher falls back to evergreen automatically. Check the log — it will say "Live research failed — using evergreen fallback for week of [date]."

**Generator returns invalid JSON**  
`lib/claude.js` strips markdown code fences before parsing. If it still fails, the raw Claude response is logged. Usually means the prompt was truncated — check max_tokens setting in generator.js.

**Designer fails on a single slide**  
The fallback renderer kicks in: plain white background, black text, content only. The pipeline continues. Check logs for "Slide N render failed — using fallback."

**PostPeer call fails**  
Scheduler writes to `/output/queue/` automatically. Run `node scripts/push-queue.js` to post manually when PostPeer is back.

**Analyst skips with "not configured"**  
Normal behavior when `INSTAGRAM_ACCESS_TOKEN` is not set. Add the token to `.env` to enable analytics.

## Environment variables

See `.env.example` for the full list with inline comments. Minimum to run:
- `ANTHROPIC_API_KEY` — required for all content generation

Optional but recommended for full functionality:
- `POSTPEER_API_KEY` + `POSTPEER_ACCOUNT_ID` — auto-posting
- `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_BUSINESS_ACCOUNT_ID` — analytics feedback loop
- `SERPAPI_KEY` — live research (otherwise evergreen fallback always used)

## Phase 2 roadmap

Items marked `// TODO: Twilio alert — add in Phase 2` in the codebase:

1. **Twilio alerts** — SMS to Dave when Scheduler runs successfully, with summary of what was posted
2. **Twilio weekly summary** — SMS with analytics highlights after Analyst runs
3. **Airtable swap** — replace local JSON with Airtable in `lib/store.js`. No agent code changes needed.
4. **A/B testing visuals** — swap `DESIGN_CONFIG` in `lib/canvas-render.js` from dark navy to white + teal. Track engagement by visual variant in analytics.
5. **Caption A/B variants** — generator writes 2 hook variations per week. Analyst tracks which version performed better after 4 weeks.
6. **Pattern analysis** — after 4+ weeks of data, analyst runs a Claude API call to identify content patterns and recommend schedule adjustments.
7. **Reeve handoff** — when analyst detects posts with profile visits >2x weekly average, `lib/reeve-handoff.js` flags them for Reeve's DM agent to increase activity.

## Content design hypothesis

Current design (v1): dark navy (#0B1120) background, teal (#1DA884) accent, white headline text, light gray body text.

Rationale: brand consistency with Reeve's overall aesthetic. Testable.

To A/B test: update `DESIGN_CONFIG` in `lib/canvas-render.js`. All render functions reference this config object — the entire visual can be swapped in one place.
