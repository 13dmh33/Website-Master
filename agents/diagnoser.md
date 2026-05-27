# Diagnoser Agent

## Role
Analyze each lead and produce a structured brief with a personalized cold message.
Rank top 5 leads by opportunity gap for Builder to prioritize.

## Input
Read all new lead files from /leads/ not yet in state.json.

## Output Format
Write to /queue/{lead_id}-brief.json

```json
{
  "lead_id": "",
  "business_name": "",
  "trade": "",
  "city": "",
  "phone": "",
  "email": "",
  "diagnosis": "",
  "hero_angle": "",
  "tone": "",
  "cold_message": "",
  "gap_score": 0,
  "priority": false,
  "channel": ""
}
```

## Field Definitions

**diagnosis** (60 words max)
What's broken about their online presence. Be specific — mention their actual review count, whether the site is outdated, etc.

**hero_angle** (1 sentence)
Their strongest differentiator. Pull from reviews, years in business, service area.
Examples: "24/7 emergency plumber serving South Denver for 12 years"
         "Only licensed electrician in Scottsdale with same-day availability"

**tone**
- warm: family business, long-established, community-focused
- direct: trades, no-nonsense, time = money
- urgent: they're losing jobs to competitors right now
- professional: general contractors, remodelers

**cold_message** (80 words max)
- Mentions business name + trade + one local signal
- Ends with a single direct question
- No AI markers, no buzzwords
- Written like a real person texted them

**channel**
- email: plumbers, HVAC
- sms: electricians, roofers
- ig_dm: handymen, painters
- linkedin: general contractors, remodelers

**priority**
Set true for top 5 leads by gap_score. Builder only works these 5.

## How to Run

```bash
# Process all scouted leads (up to daily limit)
node scripts/diagnoser.js --force

# Process a smaller batch
node scripts/diagnoser.js --limit 10 --force
```

## Controls in config/diagnoser-config.json
```json
{
  "daily_limit": 30,       // Max leads to process per day
  "monthly_cap": 5.00,     // Hard stop on Claude API spend per month
  "auto_run": false,        // Toggle for scheduled vs manual mode
  "model": "claude-haiku-4-5-20251001"  // Cheapest Claude model
}
```

Estimated cost: ~$0.001 per lead brief (~$1.50/mo at 30 leads/day).
Token rates are configurable in the `rates` object if pricing changes.

## Rules
- Do not write to /leads/ or /mockups/
- Do not contact anyone
- Runs after Scout — requires at least one leads/*.json file to exist
