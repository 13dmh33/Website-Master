# Website Master — Maps Agency

Solo AI agency system for selling websites + Nora voice agent bundles to home service contractors.

## Structure

```
/agents/        — System prompts for all 7 agents
/leads/         — Raw leads from Scout (JSON per city+date)
/queue/         — Processed briefs from Diagnoser
/mockups/       — Lovable URLs + video links from Builder/Filmer
/messages/      — Outreach log from Pitcher
/logs/          — Daily run logs
CLAUDE.md       — Orchestrator config (loaded by Claude Code at startup)
state.json      — Shared lead state across all agents
```

## 7 Agents

| Agent | Role | Daily Output |
|---|---|---|
| Scout | Finds leads on Google Maps | 30 leads |
| Diagnoser | Writes briefs + cold messages | 30 briefs |
| Checker | Quality-gates every message | Blocks bad, approves good |
| Builder | Builds Lovable mockups | 5 sites |
| Filmer | Renders 10s video of mockup | 5 videos |
| Pitcher | Sends outreach by channel | 30 messages |
| Mobile | Books calls from replies | Real-time |

## Revenue Model

- Website: $400 one-time
- Nora voice agent: $300–500/mo
- Bundle: $350/mo (website hosting + Nora)
- Target: 47 clients/mo = ~$18K/mo

## Setup

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`
2. Clone this repo: `git clone https://github.com/13dmh33/Website-Master`
3. `cd Website-Master && claude`
4. Claude Code reads CLAUDE.md and activates the orchestrator
5. When prompted: enter target city and trade to begin

## Required Accounts
- Anthropic API (Claude) — agents
- SerpAPI or Outscraper — Google Maps data for Scout
- Lovable.dev — website mockups for Builder
- Higgsfield.ai — video rendering for Filmer
- Resend or SendGrid — email for Pitcher
- Twilio — SMS for Pitcher (reuse from Nora)
- Calendly — call booking for Mobile
