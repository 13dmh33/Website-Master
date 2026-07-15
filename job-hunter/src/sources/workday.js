// workday.js — STUB, intentionally not implemented in v1.
//
// Large industrial employers (e.g. Daikin, the HVAC-distributor targets Dave
// flagged) often run Workday, which needs a per-tenant endpoint rather than one
// public board API. Per the coverage note in the spec, this is deliberately
// deferred: we do NOT build it in v1. When a specific named employer justifies
// it, add that tenant here (host + tenant + career-site path) and normalize its
// postings into the same shape every other source returns.
//
// Normalized shape to target when this is built:
//   { source: 'workday', company, title, location, remote, url, description, postedAt }

export async function pullWorkday() {
  // Not implemented in v1 — returns nothing so the orchestrator treats Workday
  // as simply "no results" rather than an error.
  return [];
}

export const WORKDAY_STUB = true;
