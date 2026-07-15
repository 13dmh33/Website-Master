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
greenhouse:
lever:
ashby:

# Adzuna keyword searches (one role per line)
adzuna_query: commercial national accounts leader
adzuna_query: national account manager
adzuna_query: director sales

# Locations (a line reading "Remote" searches nationwide)
location: Denver, CO
location: Remote

# Titles / seniority you are targeting (helps the rules filter)
title: analyst, associate, manager
seniority: mid, senior

# Hard filters
remote_ok: true
comp_floor: 90000
deal_breaker: unpaid, commission-only, door-to-door

# Federal jobs (USAJobs). Off by default.
include_federal: false
```

## Target titles and seniority (free text)

DAVE HETTINGER, commercial national accounts leader, based in
Denver, CO. Edit this paragraph to describe the roles you actually want
and the level you are targeting — the scorer reads it as your real preferences.
Add industries to favor or avoid, and any pivot you are making (for example
finance/analytics roles that draw on your P&L and pricing background).

## Must-haves

- Remote, or within commuting distance of Denver, CO.

## Deal-breakers

- Unpaid or commission-only roles.

## Notes

Add anything else here that should shape which jobs rank highly — company size,
industries to favor or avoid, comp expectations, working style.
