// workday.js — STUB, intentionally not implemented.
//
// Researched 2026-07-16: Workday exposes an unauthenticated JSON endpoint per
// tenant (POST {tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs),
// technically reachable without login. But Workday's Terms of Service and End
// User Agreement explicitly prohibit crawling/scraping their sites — unlike
// Greenhouse's Job Board API, this isn't a published, sanctioned public API,
// it's the internal endpoint powering each tenant's own career-site JS. Same
// standard applied to LinkedIn/Indeed (login walls / ToS) elsewhere in this
// pipeline: not built, not planned, regardless of employer demand.

export async function pullWorkday() {
  // Not implemented, by design — returns nothing so the orchestrator treats
  // Workday as simply "no results" rather than an error.
  return [];
}

export const WORKDAY_STUB = true;
