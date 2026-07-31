// offline.mjs — deterministic checks for the pipeline logic.
//
// No API keys, no network. Runs anywhere. Covers the pieces that must be exactly
// right: freshness ranking, the age cutoff, dedup/near-dup merge, the rules
// filter, and real .docx rendering. Run with: `npm test`.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobId, mergeNearDuplicates } from '../src/lib/dedup.js';
import { freshnessBonus, blendScore, withinMaxAge } from '../src/lib/recency.js';
import { runFilter } from '../src/filter.js';
import { writeDocx } from '../src/lib/docx.js';
import { extractJson } from '../src/lib/claude.js';
import { getCachedScore, cacheScore } from '../src/lib/state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-07-15T12:00:00Z');
const iso = (daysAgo) => new Date(now.getTime() - daysAgo * 86400000).toISOString();

let passed = 0;
const ok = (label) => {
  passed++;
  console.log(`ok  ${label}`);
};

// 1. Freshness bonus buckets
assert.equal(freshnessBonus({ postedAt: iso(1) }, now), 15);
assert.equal(freshnessBonus({ postedAt: iso(5) }, now), 8);
assert.equal(freshnessBonus({ postedAt: iso(10) }, now), 3);
assert.equal(freshnessBonus({ postedAt: iso(20) }, now), 0);
ok('freshness bonus buckets (+15 / +8 / +3 / +0)');

// 2. Recency ranking: fresh beats stale even at lower raw fit
assert.ok(blendScore(80, freshnessBonus({ postedAt: iso(1) }, now)) > blendScore(80, freshnessBonus({ postedAt: iso(20) }, now)));
assert.ok(blendScore(75, 15) > blendScore(82, 0), 'fresh 75 (=90) outranks stale 82');
ok('recency ranking (fresh outranks stale)');

// 3. Age cutoff before any paid call
assert.equal(withinMaxAge({ postedAt: iso(30) }, 21, now), false);
assert.equal(withinMaxAge({ postedAt: iso(10) }, 21, now), true);
ok('age cutoff drops postings older than MAX_AGE_DAYS');

// 4. Dedup: stable id + near-dup merge prefers the direct ATS link
const ats = { source: 'greenhouse', company: 'ramp', title: 'Senior Analyst', location: 'Remote', url: 'https://boards.greenhouse.io/ramp/jobs/1', postedAt: iso(6) };
const agg = { source: 'adzuna', company: 'Ramp', title: 'Sr Analyst', location: 'Remote, US', url: 'https://adzuna.com/xyz', postedAt: iso(2) };
assert.equal(jobId(ats), jobId(ats), 'jobId is deterministic');
const merged = mergeNearDuplicates([agg, ats]);
assert.equal(merged.length, 1, 'near-dups merge to one');
assert.equal(merged[0].source, 'greenhouse', 'kept the direct ATS link over the aggregator');
ok('dedup + near-dup merge (ATS preferred over aggregator)');

// 4b. Near-dup merge collapses remote:true postings that list different real
// cities per listing (e.g. Georgia-Pacific reposting the same remote role
// separately for Chicago/Dallas/St. Louis) — regression for the bug where
// these survived as distinct "jobs" because the location string itself never
// said the word "remote".
const remoteChicago = { source: 'adzuna', company: 'Georgia-Pacific', title: 'National Account Manager - Foodservice - Remote', location: 'The Gap, Chicago', remote: true, url: 'https://adzuna.com/a', postedAt: iso(1) };
const remoteDallas = { source: 'adzuna', company: 'Georgia-Pacific', title: 'National Account Manager - Foodservice - Remote', location: 'Highland Park, Dallas', remote: true, url: 'https://adzuna.com/b', postedAt: iso(2) };
const remoteMerged = mergeNearDuplicates([remoteChicago, remoteDallas]);
assert.equal(remoteMerged.length, 1, 'same remote role listed under different cities merges to one');
ok('near-dup merge collapses remote postings listed under different cities');

// 4b-ii. The same ONSITE req blasted across many nearby localities collapses
// to one. Real case, 2026-07-31: Bayer posted an identical "National Account
// Director - Health Systems - Western USA" to Adzuna under seven Washington
// towns, each with its own ad id. The location-aware pass keys on the city
// token for non-remote jobs, so all seven survived and consumed seven of the
// eight daily tailoring slots — seven paid Sonnet calls all writing to the
// same output directory, and a digest with nothing else in it.
const bayerTowns = ['Normandy Park, King County', 'Othello, Adams County', 'University Place, Pierce County', 'Tumwater, Thurston County', 'Warden, Grant County', 'Issaquah, King County', 'International, King County'];
const bayerPostings = bayerTowns.map((location, i) => ({
  source: 'adzuna',
  company: 'Bayer',
  title: 'National Account Director - Health Systems - Western USA',
  location,
  remote: false,
  url: `https://adzuna.com/land/ad/58220706${i}`,
  externalId: `adzuna:58220706${i}`,
  postedAt: iso(1),
}));
const bayerMerged = mergeNearDuplicates(bayerPostings);
assert.equal(bayerMerged.length, 1, 'one req across seven towns collapses to one job');
assert.equal(bayerMerged[0].alsoPostedIn.length, 6, 'the other six locations are rolled up, not discarded');
ok('near-dup merge collapses one onsite req blasted across many localities');

// 4b-iii. Genuinely different roles at the same company must NOT be merged by
// the location-blind pass — it keys on title, so distinct titles stay distinct.
const sameCoDifferentRoles = mergeNearDuplicates([
  { source: 'adzuna', company: 'Bayer', title: 'National Account Director', location: 'Seattle, WA', url: 'https://adzuna.com/x', postedAt: iso(1) },
  { source: 'adzuna', company: 'Bayer', title: 'Director of Pricing Strategy', location: 'Seattle, WA', url: 'https://adzuna.com/y', postedAt: iso(1) },
]);
assert.equal(sameCoDifferentRoles.length, 2, 'different titles at the same company stay separate');
ok('location-blind merge keeps genuinely different roles apart');

// 4c. jobId stays stable across two pulls of the same Adzuna posting even
// when Adzuna's redirect_url carries a different per-request tracking token
// each time — regression for the bug where job identity was built from the
// tracking link instead of Adzuna's own stable ad id (job.externalId).
const pullOne = { source: 'adzuna', company: 'Acme Corp', title: 'Director of Sales', url: 'https://adzuna.com/land/ad/123?se=abc111&v=xyz111', externalId: 'adzuna:123' };
const pullTwo = { source: 'adzuna', company: 'Acme Corp', title: 'Director of Sales', url: 'https://adzuna.com/land/ad/123?se=def222&v=uvw222', externalId: 'adzuna:123' };
assert.equal(jobId(pullOne), jobId(pullTwo), 'same externalId keeps jobId stable despite a different tracking url each pull');
// Without an externalId (a source that doesn't provide one), url is still the fallback identity.
const noExternalId = { source: 'greenhouse', company: 'Acme Corp', title: 'Director of Sales', url: 'https://boards.greenhouse.io/acme/jobs/1' };
assert.equal(jobId(noExternalId), jobId({ ...noExternalId }), 'url remains the fallback identity when externalId is absent');
ok('jobId prefers a stable externalId over a tracking url when the source provides one');

// 5. Rules filter: deal-breaker, seniority, location
const prefs = {
  greenhouse: [], lever: [], ashby: [], adzuna_query: [],
  location: ['Denver, CO', 'Remote'], title: ['manager'], seniority: ['mid', 'senior'],
  deal_breaker: ['commission-only', 'unpaid'], must_have: [], remote_ok: true, comp_floor: null, include_federal: false,
};
const jobs = [
  { id: '1', title: 'National Account Manager', description: 'great role', location: 'Denver, CO', remote: false },
  { id: '2', title: 'Sales Intern', description: 'summer', location: 'Remote', remote: true },
  { id: '3', title: 'Commission-only Rep', description: 'unpaid base', location: 'Remote', remote: true },
  { id: '4', title: 'Account Director', description: 'ok', location: 'Austin, TX', remote: false },
];
const { kept } = runFilter(jobs, prefs);
const keptIds = kept.map((j) => j.id);
assert.deepEqual(keptIds, ['1'], 'only the Denver manager role survives the rules');
ok('rules filter (deal-breaker + seniority + location)');

// 6. docx render produces a real, non-empty .docx (zip header "PK")
const out = path.join(here, '..', 'out', 'test', 'sample.docx');
await writeDocx('# Dave Hettinger\n\n## Experience\n\n- **Motili** — National Account Manager', out);
const buf = fs.readFileSync(out);
assert.ok(buf.length > 500 && buf[0] === 0x50 && buf[1] === 0x4b, 'docx is a valid non-empty zip');
fs.rmSync(path.join(here, '..', 'out', 'test'), { recursive: true, force: true });
ok(`docx render (${buf.length} bytes)`);

// 7. extractJson tolerates a raw literal newline inside a JSON string value
// (the exact failure mode seen live: tailorJob's resume_markdown field with
// an unescaped newline breaks a naive JSON.parse with "Bad control character
// in string literal").
{
  const brokenJson = '{"resume_markdown": "Line one\nLine two", "cover_letter_markdown": "ok"}';
  assert.throws(() => JSON.parse(brokenJson), 'sanity: raw JSON.parse must reject this input');
  const parsed = extractJson(brokenJson);
  assert.equal(parsed.resume_markdown, 'Line one\nLine two');
  assert.equal(parsed.cover_letter_markdown, 'ok');
  ok('extractJson repairs unescaped control chars in JSON string values');
}

// 8. Score cache: miss when empty, hit when fingerprint matches, miss again
// when the fingerprint changes (resume/preferences edited) — this is what
// lets runScorer skip a paid Haiku call for a job it already scored, while
// still correctly invalidating on a real profile/preferences change.
{
  const state = { scores: {} };
  assert.equal(getCachedScore(state, 'jobA', 'fp1'), null, 'empty cache misses');
  cacheScore(state, 'jobA', 'fp1', { fit: 82, rationale: 'good fit', keywords: ['x'] });
  const hit = getCachedScore(state, 'jobA', 'fp1');
  assert.ok(hit && hit.fit === 82, 'cache hit returns the stored score under the same fingerprint');
  assert.equal(getCachedScore(state, 'jobA', 'fp2'), null, 'changed fingerprint (resume/prefs edit) invalidates the cache');
  ok('score cache hits on matching fingerprint, misses on a changed one');
}

console.log(`\n${passed} checks passed.`);
