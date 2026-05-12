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
