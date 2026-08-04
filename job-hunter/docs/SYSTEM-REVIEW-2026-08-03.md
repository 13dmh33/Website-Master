# Missy — system review

**Date:** 2026-08-03
**Subject:** Automated job-search pipeline ("Missy")
**Purpose:** Architecture overview and critique, for outside review
**Status:** In production. Runs daily, unattended, since late July 2026.

---

## 1. What it is

Missy is a personal job-search pipeline for one candidate. It runs unattended
every morning at 4:45am, pulls fresh job postings from public sources, scores
each against the candidate's real background, writes a tailored resume and
cover letter for the best handful, and emails a digest for manual review.

Nothing is ever submitted automatically. Every output is a draft for a human to
review, edit, and send.

Stack: Node.js, Claude (Haiku for scoring, Sonnet for writing), Adzuna job API,
Google Sheets for tracking, Zoho SMTP for delivery.

---

## 2. Architecture

Six stages, deliberately ordered so that free work eliminates candidates before
any paid work begins.

| Stage | Function | Cost |
|---|---|---|
| **Ingest** | Parses the master resume (PDF) into structured JSON. One-time, re-run when the resume changes. | Free |
| **Scout** | Pulls postings from configured sources; assigns stable IDs; dedups exact and near-duplicates; drops anything older than 21 days. | Free |
| **Filter** | Rules pass. Drops deal-breaker keywords and clear seniority mismatches. Deliberately conservative — when in doubt it keeps the job and lets the scorer decide. | Free |
| **Scorer** | Claude Haiku rates fit 0–100 with a one-line rationale and the top keywords to mirror. | Low |
| **Tailor** | Claude Sonnet writes a tailored resume and cover letter for the top N (default 8). | High |
| **Career-coach** | Re-ranks the same matches against a separate, richer brief, then drafts 1–3 for explicit approval. Allowed to disagree with the scorer — that is the point. | High |

### Design decisions worth noting

**Cost tiering is enforced structurally, not by convention.** Roughly 1,100
postings have been scored to date; only 8 per day ever reach the expensive
model. A free rules pass runs before any API call.

**Scores are cached against a fingerprint** of the profile plus preferences.
Re-running the pipeline costs nothing for already-seen jobs, but editing the
resume or preferences invalidates every cached score at once — correctly, since
the basis for judgment changed.

**Truthfulness is an explicit constraint.** The tailoring prompt forbids
inventing qualifications, and each digest entry lists what the posting asked for
that the candidate genuinely lacks, labelled "omitted, not faked."

**Two independent judgments.** The scorer and the career-coach read different
context files and are permitted to reach different conclusions. Disagreement is
treated as signal rather than as a bug to reconcile.

---

## 3. How ranking works

```
final score = min(100, rawFit + freshnessBonus + locationDelta)
```

- **rawFit** — Claude Haiku, 0–100, judged against the candidate profile,
  free-text preferences, and recent feedback examples.
- **freshnessBonus** — `+15` (posted <2 days), `+8` (<7d), `+3` (<14d), `+0`
  (older). Intentional: a fresh 75 should outrank a stale 82, because
  application timing materially affects outcomes.
- **locationDelta** — remote, onsite-match, hybrid-match, and unknown all score
  `+0`; onsite- or hybrid-*mismatch* scores `−15`.

A `MIN_SCORE` threshold (default 70) then cuts, and `DAILY_LIMIT` (default 8)
caps how many reach the expensive tailoring stage.

Location was previously a hard exclusion in the filter stage. It was changed to
additive scoring on 2026-07-30 because a location *parsing* failure was being
punished more harshly than missing location data — an asymmetry that silently
discarded viable jobs.

---

## 4. Context sources

Three files drive all judgment:

| File | Size | Consumed by |
|---|---|---|
| `inputs/preferences.md` | 3 KB | Everything. Machine-readable config block (search queries, target titles, comp floor, deal-breakers) plus free text the model reads directly. |
| `data/master-profile.json` | 17 KB | Scorer and tailor. Parsed from the real resume; treated as the only source of truth about the candidate's experience. |
| `data/career-context.md` | 11 KB | Career-coach only. A richer strategic brief including positioning, vetted accomplishment metrics, and standing conclusions. |

---

## 5. Findings

### 5.1 Scores are far less discriminating than they appear

Distribution across all 1,124 jobs scored to date:

```
distinct fit values:  21

fit 28 → 176 jobs        fit 72 →  89 jobs
fit  5 → 158 jobs        fit 12 →  86 jobs
fit 42 →  96 jobs        fit 32 →  83 jobs
fit 22 →  74 jobs        fit  8 →  74 jobs

fit >= 70 (threshold):  94 of 1,124  (8%)
```

The model is **bucketing, not rating**. Eighty-nine jobs share the exact value
72. Within a bucket the system has no ability to rank at all, so the effective
tiebreaker becomes the freshness bonus.

The visible consequence: nearly every digest entry scores **87/100** — that is
`72 + 15` for "posted today." The number reads as a fine-grained judgment but
encodes roughly one bit: *cleared the threshold, and is recent*. The daily top 8
is closer to "the 8 most recent jobs above a coarse bar" than "the 8 best."

The pipeline already detects this. A duplicate-fit-score check fires on
essentially every run and reports it in the digest, but it is explicitly
informational and nothing downstream acts on it.

**This is the root issue.** Everything downstream inherits the ordering, so
improvements elsewhere are bounded by it.

### 5.2 Only one source is active, and it is the weakest kind

The configuration supports direct pulls from company applicant-tracking systems
(Greenhouse, Lever, Ashby), federal listings (USAJobs), and the Adzuna
aggregator. In practice:

- All ATS slugs are blank
- USAJobs is disabled
- **Every job ever surfaced came from Adzuna**

Consequences: company career pages — where listings are freshest and least
contested — are never seen; aggregator-specific noise dominates; and
recruiter-reposted listings compete on equal footing with direct employer
postings.

A concrete instance: on 2026-07-31 a single employer posted one identical
requisition under seven different towns, each with its own aggregator ID. All
seven passed dedup, consumed seven of the eight daily tailoring slots (seven
paid model calls all writing to the same output directory), and crowded every
other opportunity out of that day's digest. Since fixed, but the class of
problem is inherent to aggregator sourcing.

### 5.3 The feedback loop is inert

The scorer is designed to calibrate against the candidate's real behaviour: rows
marked applied / passed / interview in a tracking sheet are fed back as taste
examples, weighted heavily in the prompt.

Current state:

```
[scorer] calibrating with 2 marked rows from the tracker sheet.
```

Two examples is noise. The mechanism is built and working; it is simply not
being fed. This is the cheapest available improvement and would also help break
up the scoring buckets described in 5.1, since concrete examples give the model
something to discriminate against.

### 5.4 Smaller observations

- **The threshold sits in a gap.** Buckets exist at 62 and 72 with nothing
  between, so `MIN_SCORE = 70` is really "did the model pick 72 or higher."
  Moving it to 65 or 75 would change nothing; moving it to 60 would roughly
  double volume in a single step. The knob is not continuous.
- **Location provides no positive signal.** A genuinely remote role and an
  arbitrary onsite city both score `+0`. Only mismatches are penalised, so the
  ideal case is indistinguishable from the neutral case.
- **Selectivity is unverified.** 8% of scored jobs clear the bar. Whether that
  reflects healthy selectivity or an over-tight funnel cannot be answered from
  the data alone — it depends on outcomes for those 94, which is precisely what
  the unfilled feedback loop would reveal.

---

## 6. Recommendations

**In priority order.**

1. **Force score differentiation.** Ask the model for a rank-ordered comparison
   within each batch, or require distinct values, rather than independent
   absolute ratings per job. This is the root cause; ordering quality
   downstream is capped by it.

2. **Add direct ATS sources.** Configure 10 target-company job boards. Likely a
   larger quality improvement than any scoring change, and it reduces exposure
   to aggregator duplication.

3. **Populate the feedback loop.** Mark 15–20 rows in the tracking sheet. Human
   effort, not engineering, and it activates calibration that already exists.

4. **Reconsider location scoring.** Give remote and target-metro matches a
   positive bonus rather than treating them as merely un-penalised.

An open question worth settling before implementing (1): if the buckets break
apart but the resulting order optimises for the wrong thing, that is not
progress. Defining what "good match" means for this candidate — in terms
concrete enough to evaluate against — should probably precede the scoring work.

---

## 7. What is working well

Stated plainly, since the above is weighted toward problems:

- **Cost discipline is structural.** Free filtering precedes paid scoring;
  expensive generation is capped at 8 per day regardless of volume.
- **Caching is correctly keyed.** Invalidation is tied to the inputs that
  actually change judgment, not to time.
- **Failure is contained.** A failure in the career-coach stage cannot take
  down the digest; a source returning nothing degrades rather than crashes.
- **The truthfulness constraint is real**, and gaps are surfaced explicitly
  rather than papered over.
- **Two independent judgments** on the same set is an unusually good design
  choice for this problem, and worth preserving through any scoring rework.
