# Filmer Agent

## Role
Take screenshots of each mockup and render a short vertical video for cold outreach.

## Input
Read Lovable URLs from /mockups/{lead_id}-v1.txt

## Output
Save video URL or file path to /mockups/{lead_id}-video.txt

## Screenshot Steps
Take 5 screenshots of each mockup:
1. Full page (scrolled to top)
2. Hero section only
3. Services section
4. Trust/reviews section
5. Contact/CTA section

Tool options (in order of preference):
- ScreenshotOne API (screenshotone.com)
- Puppeteer headless browser
- Manual screenshot if APIs unavailable (flag with "manual" in output file)

## Higgsfield Prompt (submit with screenshots)
```
10-second vertical video, 1080x1920 resolution.
Animation: soft zoom starting from full-page view, slowly pushing in to the hero section.
Style: professional, clean reveal. No text overlays. No harsh cuts.
Audio: none (will be added separately).
Purpose: cold outreach video showing a website mockup to a small business owner.
```

## Fallback (if Higgsfield unavailable)
Record a 60-second Loom walkthrough of the mockup manually.
Save Loom URL to /mockups/{lead_id}-video.txt with prefix "loom:"

## Rules
- Do not send the video anywhere — Pitcher handles delivery
- Do not write to /queue/ or /leads/
- If video generation fails, write "pending_manual" to the video file and continue

---

## Script: scripts/filmer.js

### Usage
```bash
node scripts/filmer.js --force                                      # write video instructions
node scripts/filmer.js --submit --lead {lead_id} --url loom:{url}  # record Loom URL
```

Higgsfield.ai requires invite access and is not integrated. The script:
1. Reads `mockups/{lead_id}-v1.txt` for leads with a real Lovable URL
2. Optionally captures a screenshot via ScreenshotOne (set `SCREENSHOTONE_API_KEY`)
3. Writes `pending_manual` + Loom instructions to `mockups/{lead_id}-video.txt`

Record the Loom walkthrough manually, then use `--submit` to store the URL.
Pitcher reads `video.txt` and attaches the link to the outreach message.

### Config: config/filmer-config.json
```json
{
  "daily_limit": 5,
  "auto_run": false,
  "filmed_today": 0,
  "total_filmed": 0
}
```

### Optional environment variable
```
SCREENSHOTONE_API_KEY=    # enables mobile screenshot capture (screenshotone.com)
```

### Outputs
- `mockups/{lead_id}-video.txt` — "pending_manual" instructions, or Loom URL after --submit
- `mockups/{lead_id}-screenshot.txt` — ScreenshotOne URL (if API key set)
- `state.json` — status: mockup_ready → film_pending or filmed
