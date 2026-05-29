# Builder Agent

## Role
Build a landing page mockup in Lovable.dev for each of the top 5 daily priority leads.

## Input
Read priority briefs from /queue/ where priority = true and checker_approved = true.
Process max 5 per day.

## Output
Save Lovable URL to /mockups/{lead_id}-v1.txt

## Lovable Prompt Template
Generate this prompt for each lead, then submit to Lovable.dev:

---
Build a landing page for [BUSINESS_NAME], a [TRADE] based in [CITY].

Hero angle: [HERO_ANGLE]

Sections (in order):
1. HERO: Large headline using the hero angle. Subheadline with service area.
   CTA button: "Get a Free Quote" — links to #contact
2. SERVICES: 3–4 services with icons. Use trade-specific services only.
3. TRUST: Years in business badge, Licensed & Insured badge, service area map or list.
4. REVIEWS: Placeholder for 3 Google reviews with star rating display.
5. CONTACT/FOOTER: Phone number large and prominent. Simple contact form.

Design rules:
- Mobile-first layout (majority of traffic is phone)
- Clean, trust-focused — NOT trendy or startup-looking
- Color scheme: [COLOR] (blue for plumbing, red/orange for HVAC, yellow/grey for electrical, green for landscaping)
- Font: Inter or similar — readable, professional, not decorative
- No stock photos — use solid colors and icons only
- Page load must be fast — no heavy animations

Output: single-page HTML or Lovable deploy URL
---

## Color Guide
- Plumber: #1a4f8a (navy blue)
- HVAC: #c0392b (red) or #e67e22 (orange)
- Electrician: #f39c12 (amber) + dark grey
- Roofer: #7f8c8d (slate) + dark brown
- Handyman: #27ae60 (green)
- Default / General Contractor: #2E5B8A (Trevo Slate Blue)

## Trevo Advisors Brand Colors (for agency materials, not contractor mockups)
- Primary:    #2E5B8A Slate Blue — headers, CTAs, nav
- Secondary:  #2E7D5B Growth Green — success signals
- Background: #F8F7F3 Warm Cream — page/card fills
- Accent:     #C8720E Amber — use sparingly, 1× per view

## Rules
- Only process priority = true leads
- Max 5 mockups per day
- Do not write to /queue/ or /leads/
- Save the Lovable URL exactly as returned — do not modify

---

## Script: scripts/builder.js

### Usage
```bash
node scripts/builder.js --force                                    # generate prompts
node scripts/builder.js --submit --lead {lead_id} --url {url}     # record Lovable URL
```

Lovable has no public API. The script generates a filled-in prompt for each priority lead
and saves it to `mockups/{lead_id}-lovable-prompt.txt`. You paste it into lovable.dev,
copy the deploy URL, then use `--submit` to record it.

### State machine
```
checker_approved → (builder --force) → mockup_pending  (prompt saved, waiting for Lovable)
mockup_pending   → (builder --submit) → mockup_ready   (URL saved to v1.txt)
mockup_ready     → (filmer --force)   → film_pending   (video instructions written)
film_pending     → (filmer --submit)  → filmed         (Loom URL saved to video.txt)
filmed           → Pitcher attaches video URL to outreach message
```

### Config: config/builder-config.json
```json
{
  "daily_limit": 5,
  "auto_run": false,
  "built_today": 0,
  "total_built": 0
}
```

### Outputs
- `mockups/{lead_id}-lovable-prompt.txt` — paste into lovable.dev
- `mockups/{lead_id}-v1.txt` — "prompt_ready" until --submit records the real URL
- `state.json` — status: checked → mockup_pending or mockup_ready
