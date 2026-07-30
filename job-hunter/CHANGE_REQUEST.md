# Change request — job scoring and output pipeline

Drafted 2026-07-30 from Dave's verbal description (confirmed via clarifying questions —
his own proposed state names/framing confirmed outright, specific numbers/formats below
chosen by Claude where he said "do what you see fit"). This is the saved record of what
was actually implemented against — see `git log` for the commit(s) that closed it out.

## Change 1 — Apply URLs

Every match in the digest must show its apply URL as raw text — never auto-linkified or
line-wrapped in the plain-text digest, since a wrapped URL breaks when copy-pasted.
Three cases:

1. **Single URL** — most sources (Adzuna, Greenhouse, USAJobs): show it plainly.
2. **Source-vs-employer pair** — Ashby (`jobUrl` vs `applyUrl`) and Lever (`hostedUrl` vs
   `applyUrl`) each have two possible upstream links, previously collapsed via `||` into
   one, silently discarding the other. Show both when both exist, labeled which is
   which ("via Ashby" / "employer site").
3. **NOT CAPTURED** — no URL field existed upstream (`job.url === ''`): show
   `apply: NOT CAPTURED` explicitly rather than a blank or broken line.

## Change 2 — Work location (UNKNOWN must be score-neutral)

Classify every job into exactly one of **REMOTE / ONSITE / HYBRID / UNKNOWN**, plus a
separate **MULTI** flag for multi-city requisitions. This replaces the previous
Stage-2 hard filter (`filter.js`'s `failsLocation()`), which dropped a job entirely on
any non-empty, unmatched, or garbled location string while treating an *empty* location
as neutral — an asymmetry that meant a location-parsing failure produced a *worse*
outcome (hard exclusion) than simply having no location data at all. Location is now a
scored dimension, not an exclusion gate.

**Scoring deltas** (added into the blended score alongside fit + freshness):

| State | Condition | Delta |
|---|---|---|
| `REMOTE` | job/source marked remote | **+0** |
| `ONSITE` | location matches a target area | **+0** |
| `ONSITE` | location doesn't match any target area, not remote | **-15** |
| `HYBRID` | matches a target area (or no target configured) | **+0** |
| `HYBRID` | doesn't match any target area | **-15** |
| `UNKNOWN` | location empty, or doesn't parse as a real place | **+0, always, unconditionally** |
| `MULTI` | posting spans multiple locations | **+0, always** — can't tell which office would apply |

**Evidence line** — one line per job in the digest:
- `location: ONSITE — "Denver, CO" matches target — +0`
- `location: ONSITE — "Chicago, IL" does not match target areas, not remote — -15`
- `location: UNKNOWN — could not classify "Philatelic, Alameda County" — +0 (neutral)`
- `location: MULTI — posting lists multiple locations — +0 (neutral)`

**On the "Philatelic, Alameda County" garbled-location example flagged during
investigation:** root cause could not be determined from this codebase alone — every
source adapter (`adzuna.js`, `greenhouse.js`, `lever.js`, `ashby.js`, `usajobs.js`) maps
`location` from exactly one upstream field with no string transformation, so nothing in
this repo mangles it. Most likely an upstream Adzuna data/geocoding quality issue, not a
parsing bug here.

**Correction made during implementation:** `UNKNOWN` is defined narrowly as an *empty*
location field only — a reliable, honest signal. Adzuna's real (valid) `display_name`
format is often just "City, County Name" with no state token at all (e.g. "Colorado
Springs, El Paso County"), which is structurally identical to a garbled string like
"Philatelic, Alameda County" — there is no text-only way to tell a real-but-unfamiliar
place name from nonsense without an actual geographic database, which this pipeline
doesn't have and this change doesn't add. So a non-empty garbled string like the
Philatelic example does **not** get force-classified as `UNKNOWN` by pattern-matching
tricks — it falls through to `ONSITE`, and if it doesn't match a target area, gets the
same softened **-15** (not a hard drop) as a real, correctly-parsed non-matching city.
That still directly fixes the reported harm (hard exclusion becomes a minor penalty for
every case, garbled or not) without overclaiming a garbage-detection capability that
isn't reliably buildable from text alone.

## Change 3 — Score breakdown + identical-fit-score warning

Digest already showed `fit + freshness`; add the new location delta as a third visible
term: `score: 78/100 (fit 70 + freshness 8 + location +0)` — the three terms sum
(capped at 100) to the displayed blended score.

**Identical-fit-score warning:** if two or more jobs scored in the same run share the
exact same raw `fit` value, print a warning in both the console run summary and the
digest — e.g. `3 jobs share an identical fit score of 72 — may indicate the model
returned a default/lazy value rather than a differentiated score; spot-check these.`
