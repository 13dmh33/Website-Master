'use strict';
/**
 * Assembles the dated report — current state, funnel + cost findings with
 * integrity caveats attached, the ranked candidate list, the one defended
 * recommendation, and a backlog appendix so nothing not chosen is lost.
 * Pure — takes computed data in, returns a markdown string out.
 */

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dave's own list, surfaced in the report body rather than only inside the
 * session prompts. These are the candidates tagged `executor: 'dave'` — work
 * that needs a browser, a vendor dashboard, or a phone, and that no Claude Code
 * session can do. Previously they appeared only in session-primary.md's "Dave's
 * tasks" lane, so reading the report alone gave no view of what was blocked on
 * him. Ordered by the same revenue-weighted score as everything else.
 */
function renderDaveItems(ranking) {
  const items = (ranking.ranked || []).filter(c => c.executor === 'dave');
  if (items.length === 0) {
    return 'Nothing is currently blocked on you — every ranked candidate can be done in a Claude Code session.';
  }
  const lines = items.map((c, i) => {
    const est = c.estimateHours != null ? `, ~${c.estimateHours}h` : '';
    return `${i + 1}. **${c.label}** (score ${c.score.toFixed(1)}${est})\n   ${c.why}`;
  });
  return [
    `${items.length} item${items.length === 1 ? '' : 's'} need you — a browser, a vendor dashboard, or a phone. Nothing here can be automated away.`,
    '',
    ...lines,
  ].join('\n');
}

function renderGitHealth(gitHealth) {
  const stale = gitHealth.branches.filter(b => b.stale);
  const unpushed = gitHealth.branches.filter(b => b.unpushed);
  const mergedStale = stale.filter(b => b.mergedIntoOriginMain);
  const lines = [
    `Main vs origin: ${gitHealth.mainDivergence.ahead} ahead, ${gitHealth.mainDivergence.behind} behind.`,
    `${gitHealth.branches.length} local branches — ${stale.length} stale (14+ days), ${unpushed.length} unpushed.`,
  ];
  if (mergedStale.length > 0) {
    lines.push(`Safe to delete (stale and already merged): ${mergedStale.map(b => b.name).join(', ')}.`);
  }
  if (gitHealth.untrackedDirs.length > 0) {
    lines.push(`Untracked top-level directories: ${gitHealth.untrackedDirs.join(', ')} — confirm each is intentional.`);
  }
  return lines.map(l => `- ${l}`).join('\n');
}

function renderFunnel(funnel) {
  const d = funnel.biggestDropoff;
  const lines = [
    `Biggest drop-off: ${d ? `${d.from} -> ${d.to}, ${d.lost} leads lost (${d.conversionPct}% conversion)` : 'not enough data yet'}.`,
  ];
  if (Array.isArray(funnel.stalledStages) && funnel.stalledStages.length > 0) {
    lines.push(`Stalled stages (frozen since previous run): ${funnel.stalledStages.map(s => `${s.stage} (${s.waiting} waiting)`).join(', ')}.`);
  } else if (Array.isArray(funnel.stalledStages)) {
    lines.push('Stalled stages: none — every stage with waiting leads advanced at least one since the previous run.');
  }
  for (const [stage, count] of Object.entries(funnel.cumulativeReached)) {
    lines.push(`  ${stage}: ${count}`);
  }
  return lines.join('\n');
}

function renderResolvedAndSuperseded(ranking) {
  const parts = [];
  if (ranking.resolved && ranking.resolved.length > 0) {
    parts.push('**Already done (verified against live repo state + all branches — not re-recommended):**');
    for (const c of ranking.resolved) {
      parts.push(`- ~~${c.label}~~ — ${c.resolutionNote}`);
    }
  }
  if (ranking.superseded && ranking.superseded.length > 0) {
    parts.push('**Settled by a standing decision (not re-recommended):**');
    for (const c of ranking.superseded) {
      parts.push(`- ~~${c.label}~~ — decision "${c.decision.id}" (${c.decision.date}): ${c.decision.decision}`);
    }
  }
  return parts.length ? parts.join('\n') : '_None — every candidate is still open._';
}

function renderIntegrityFlags(flags) {
  if (flags.length === 0) return 'None.';
  return flags.map(f => `- [${f.severity}] ${f.message}`).join('\n');
}

function renderCostAudit(costAudit) {
  const lines = [
    `Actual logged spend this month (${costAudit.month}): $${costAudit.actualTotalUsd} — this repo's own cost log, not a vendor dashboard.`,
    `Cost per positive-signal outcome: ${costAudit.costPerOutcomeNote}`,
  ];
  for (const p of costAudit.projections) {
    lines.push(`- ${p.service}: ${p.active ? `$${p.monthlyUsd}/mo (active)` : `$0 (inactive)`} — ${p.note}`);
  }
  return lines.join('\n');
}

function renderRanking(ranking) {
  const lines = [];
  ranking.ranked.forEach((c, i) => {
    const marker = i === 0 ? '**[RECOMMENDED]** ' : '';
    lines.push(`${i + 1}. ${marker}${c.label} (score ${c.score.toFixed(1)}, revenue ${c.revenueProximity}/10, build ${c.buildVolume}/10, ~${c.effortHours}h)\n   ${c.why}`);
  });
  return lines.join('\n\n');
}

function buildReport({ gitHealth, pipelineSnapshot, costAudit, ranking, primaryQueueHours, lightQueueHours }) {
  const rec = ranking.recommendation;
  const date = today();

  return `# Merlin nightly report — ${date}

Advisor-only. This report recommends; it does not act. Nothing here has modified code,
branches, configs, or sent outreach.

## Recommendation

${rec ? `**${rec.label}**\n\n${rec.why}\n\nThis scored highest under the fixed rubric (revenue proximity weighted 3x above build volume — a hard rule, not a per-run preference). ${rec.buildVolume === 0 ? 'This is a zero-build, don\'t-build recommendation: the highest-value move right now is not writing more code.' : `Build volume: ${rec.buildVolume}/10.`}` : 'No candidates scored — see the ranked list appendix (empty) and check Merlin\'s candidate pool for a bug.'}

Two session prompts are attached separately (primary, ~${primaryQueueHours}h; light alternate, ~${lightQueueHours}h) — both are paste-ready, no editing required.

## Your list — what needs you

${renderDaveItems(ranking)}

## Repo health

${renderGitHealth(gitHealth)}

## Funnel state

${renderFunnel(pipelineSnapshot.funnel)}

## Resolved / settled since last run (Merlin no longer recommends these)

${renderResolvedAndSuperseded(ranking)}

## Data-integrity caveats (read before trusting the numbers above)

${renderIntegrityFlags(pipelineSnapshot.integrityFlags)}

## Apollo hit rate

Phone-only: ${pipelineSnapshot.apollo.phoneOnly.attempted} attempted, ${pipelineSnapshot.apollo.phoneOnly.hits} hits (${pipelineSnapshot.apollo.phoneOnly.hitRatePct === null ? 'n/a' : pipelineSnapshot.apollo.phoneOnly.hitRatePct + '%'}).
Has-website: ${pipelineSnapshot.apollo.hasWebsite.attempted} attempted, ${pipelineSnapshot.apollo.hasWebsite.hits} hits (${pipelineSnapshot.apollo.hasWebsite.hitRatePct === null ? 'n/a' : pipelineSnapshot.apollo.hasWebsite.hitRatePct + '%'}).

## Cost audit (estimates, assumptions listed)

${renderCostAudit(costAudit)}

Assumptions:
${costAudit.assumptions.map(a => `- ${a}`).join('\n')}

## Backlog — full ranked candidate list (nothing not chosen is lost)

${renderRanking(ranking)}

---

Generated by Merlin. Advisor only — reads and writes its own reports/prompts, nothing else.
`;
}

module.exports = { buildReport, today };
