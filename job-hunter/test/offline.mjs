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

console.log(`\n${passed} checks passed.`);
