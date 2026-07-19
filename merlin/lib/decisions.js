'use strict';
/**
 * Durable-decision loader. Reads merlin/decisions.json (settled questions a
 * review session recorded) and exposes:
 *
 * - supersededIds: candidate ids no longer to be recommended, each with the
 *   deciding record attached, so the report can show WHY it was dropped
 *   rather than silently omitting it.
 * - explanationFor(flagId): the decision that explains a given integrity flag
 *   or funnel finding, so Merlin attaches it as a caveat instead of
 *   re-presenting a settled issue as a new problem (Task 10d).
 *
 * Pure except for one file read at the edge; takes an injectable loader for
 * testing.
 */

const fs = require('fs');
const path = require('path');

const DECISIONS_PATH = path.join(__dirname, '..', 'decisions.json');

function loadDecisions(read = () => fs.readFileSync(DECISIONS_PATH, 'utf8')) {
  let raw;
  try {
    raw = JSON.parse(read());
  } catch {
    raw = { decisions: [] };
  }
  const decisions = Array.isArray(raw.decisions) ? raw.decisions : [];

  const supersededIds = new Map(); // candidateId -> deciding record
  const explanations = new Map();  // flagId/findingId -> deciding record
  for (const d of decisions) {
    for (const id of d.supersedes || []) supersededIds.set(id, d);
    for (const id of d.explains || []) explanations.set(id, d);
  }

  return {
    decisions,
    supersededIds,
    isSuperseded: (candidateId) => supersededIds.has(candidateId),
    decisionFor: (candidateId) => supersededIds.get(candidateId) || null,
    explanationFor: (flagId) => explanations.get(flagId) || null,
  };
}

module.exports = { loadDecisions, DECISIONS_PATH };
