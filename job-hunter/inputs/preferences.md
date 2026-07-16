# Missy — job search preferences

This file is yours to edit. The block below marked `config` is machine-read by
the pipeline; everything outside it is free text that Claude reads when scoring
and tailoring, so add nuance in plain language.

## Machine settings

Fill in the ATS slugs for companies you want to track. A slug is the last part
of a company's job-board URL, for example:
  greenhouse: boards.greenhouse.io/<slug>
  lever:      jobs.lever.co/<slug>
  ashby:      jobs.ashbyhq.com/<slug>

```config
# Company ATS boards to pull (comma-separated or repeat the key)
# Left blank — no specific target companies yet, relying on Adzuna keyword
# search for now. Add real Greenhouse/Lever/Ashby slugs here later once
# specific target companies are identified.
greenhouse:
lever:
ashby:

# Adzuna keyword searches (one role per line)
adzuna_query: director national accounts
adzuna_query: vp sales
adzuna_query: director sales planning
adzuna_query: director strategy
adzuna_query: director finance sales operations
adzuna_query: national accounts sales leader

# Locations (a line reading "Remote" searches nationwide)
location: Denver, CO
location: Remote

# Titles / seniority you are targeting (helps the rules filter)
title: director, senior director, vp, senior manager, manager
seniority: senior, director, vp

# Hard filters
remote_ok: true
comp_floor: 160000
deal_breaker: unpaid, commission-only, door-to-door

# Federal jobs (USAJobs). Off by default.
include_federal: false
```

## Target titles and seniority (free text)

DAVE HETTINGER — Director/Senior Manager/VP-level leader in national accounts,
sales, sales planning, finance, or strategy, based in Denver, CO, with ~20
years of progressive experience (national account P&L ownership, pricing
governance, contract negotiation, executive stakeholder presentations).
Targeting Director, Senior Director, VP, Senior Manager, or Manager titles in:
national accounts leadership, sales leadership, sales planning, finance
(commercial/sales-facing), or strategy. Open to a lateral pivot across these
functions given the overlapping P&L, pricing, and account-leadership skill set.

Favor: tech companies, HVAC/building-products companies (direct background
fit), AI companies, and large corporations generally (scale and structure
matches current experience managing ~$1.3B in revenue scope).

## Must-haves

- Remote, or within commuting distance of Denver, CO.
- Minimum base salary of $160,000.

## Deal-breakers

- Unpaid or commission-only roles.
- Base salary below $160,000.

## Notes

Favor larger/established companies over early-stage startups, given background
managing large-scale national account portfolios. Favor tech, HVAC/building
products, and AI companies specifically when they appear in search results —
weight these industries higher than an unrelated industry of similar seniority
and comp. No specific target companies identified yet for direct ATS-board
tracking (see greenhouse/lever/ashby above) — revisit once some come to mind.
