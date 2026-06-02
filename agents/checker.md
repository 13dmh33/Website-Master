# Checker Agent

## Role
Quality-gate every cold message before Pitcher sends it.
Run 5 evals. Auto-rewrite if any fail. Block after 2 failed rewrites.

## Input
Read cold_message from /queue/{lead_id}-brief.json

## Output
Update the brief with:
```json
{
  "checker_approved": true | false,
  "checker_score": {
    "personalization": 0,
    "no_ai_markers": true | false,
    "no_buzzwords": true | false,
    "structure": true | false
  },
  "final_message": "",
  "rewrite_count": 0,
  "checker_flag": ""
}
```

## Eval 1 — Personalization (score 0–100, block if under 75)
Message must mention ALL THREE:
1. Business name (exact or natural variation)
2. Specific trade (plumber, HVAC tech, electrician, etc.)
3. Local signal: city, neighborhood, or specific detail from their listing

## Eval 2 — No AI Markers (block if any found)
Scan for: "Certainly!", "As an AI", "I'd be happy to", "Great question",
"Of course!", "Absolutely!", "I hope this message finds you well",
"I wanted to reach out", "touch base", "circle back"

## Eval 3 — No Buzzwords (block if any found)
Scan for: "game-changing", "cutting-edge", "seamlessly", "leverage",
"synergy", "revolutionize", "disruptive", "innovative solution",
"next-level", "empower", "transformative", "streamline"

## Eval 4 — Structure (all must pass)
- Under 80 words total
- Ends with exactly one direct question (ends with "?")
- No more than 3 sentences before the question

## Eval 5 — No Spammy Openers (block if any found at start or within message)
Scan for: "I hope this finds you", "Just reaching out", "I wanted to touch base",
"I wanted to follow up", "Checking in", "Quick question", "I came across your",
"I noticed your", "My name is", "I specialize in", "I help businesses like yours",
"Are you looking for"

## Rewrite Rules
- If any eval fails: rewrite to pass, then re-run all 5 evals
- Maximum 2 rewrite attempts
- If still failing after 2 rewrites: set checker_approved = false, checker_flag = "human_review"
- Never send a flagged message — Pitcher checks checker_approved before sending

## How to Run

```bash
node scripts/checker.js --force
node scripts/checker.js --limit 10 --force
```

## Controls in config/checker-config.json
```json
{
  "daily_limit": 30,
  "monthly_cap": 3.00,
  "auto_run": false
}
```

Evals 1–5 run locally with no API cost.
Claude API only called when a rewrite is needed (~$0.0003/rewrite).

## Finding Flagged Messages
```bash
grep -l '"checker_flag": "human_review"' queue/*.json
```
