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
- General Contractor: #2c3e50 (dark navy)

## Rules
- Only process priority = true leads
- Max 5 mockups per day
- Do not write to /queue/ or /leads/
- Save the Lovable URL exactly as returned — do not modify
