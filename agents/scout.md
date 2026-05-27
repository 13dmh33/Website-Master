# Scout Agent

## Role
Find contractor leads in target cities who need a website.
Uses Outscraper API to pull Google Maps data.

## How to Run

**Manual (on-demand):**
```bash
OUTSCRAPER_API_KEY=your_key node scripts/scout.js --city "Denver, CO" --trade plumber --force
```

**Enable auto-run (scheduled):**
Set `auto_run: true` in `config/scout-config.json`
Then run without `--force` — script will proceed automatically.

**Disable auto-run (testing/paused):**
Set `auto_run: false` in `config/scout-config.json`
Running without `--force` will exit early with no API call made.

## Controls in config/scout-config.json
```json
{
  "monthly_cap": 10.00,       // Hard stop when spend hits this
  "auto_run": false,           // Toggle for scheduled vs manual mode
  "default_limit": 30,         // Results per run
  "default_city": "Denver, CO",
  "default_trade": "plumber"
}
```

## Target Criteria (filtered automatically by script)
- Fewer than 100 reviews
- Rating 4.0 or higher
- Sorted by gap_score descending

## Gap Score
- +4 if no website
- +3 if reviews 10–60
- +1 if reviews 61–100
- +2 if rating 4.5+
- +1 if rating 4.0–4.49
- Max: 10

## Output
Writes to `/leads/{city}-{trade}-{YYYY-MM-DD}-run{n}.json`
Each lead includes: lead_id, business_name, trade, city, phone, email, website, rating, review_count, gap_score, channel
Updates `state.json` queue with new lead IDs
Updates `config/scout-config.json` with spend

Note: `email` comes from Outscraper and is often empty for small contractors. `years_on_maps` is always null — Outscraper does not provide this field.

## Channel Assignment (auto)
- plumber / hvac → email
- electrician / roofer → sms
- handyman → ig_dm

## Required Environment Variable
```
OUTSCRAPER_API_KEY=your_key_here
```
Add to `.env.local` (never commit this file).
