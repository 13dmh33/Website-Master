# /audit — checkpoint

Status: **built, tested, dry-run-verified with mocked external calls. Not yet run against live APIs (see "what's left" below).**

## What was built

A self-contained diagnostic agent that, given a contractor's existing website URL, produces a classification (bucket + confidence) and two draft outreach assets (email hook + one-page mini-audit). It never sends anything — drafts only, written to `/audit/output/`.

Branch: `feature/site-audit` (off `main` — this repo has no `master` branch, `main` is the default branch). Nothing outside `/audit` was touched.

### File layout

```
audit/
  package.json          — isolated package, type: module, own deps (mirrors /milly's isolation pattern)
  .env.example           — PAGESPEED_API_KEY, ANTHROPIC_API_KEY, TREVO_SIGNATURE_NAME, ANTHROPIC_MODEL
  .gitignore              — node_modules, .env, generated output files
  input/leads.csv         — sample 3-row fixture (fake businesses, fake URLs/emails)
  output/                 — generated per-lead JSON/email/mini-audit + index.json (gitignored)
  lib/
    htmlChecks.js         — Module 1: domain type, platform detection, SSL, tap-to-call, contact form,
                             structured data, staleness (footer copyright year heuristic)
    pagespeed.js          — Module 1: Google PageSpeed Insights wrapper (speed/CWV/mobile-friendly)
    classifier.js         — Module 3: bucket classifier (diy-builder / pro-maintained / unknown)
    screenshot.js         — mobile-viewport homepage screenshot via Playwright Chromium
    vision.js              — Module 2: sends screenshot to Claude, returns constrained subjective findings
    compose.js              — Module 4: generates email hook + mini-audit via Claude, enforces brand
                                voice linter on the result before returning, throws if violated
    brandVoice.js           — linter: emojis, "bot", "business day(s)", Title-Case headings
  scripts/
    run.js                  — orchestrator: leads.csv -> Modules 1-4 -> output/ files, per-lead error isolation
    lint.js                  — runs `node --check` over every /audit JS file (repo has no shared ESLint config)
  test/
    htmlChecks.test.js, classifier.test.js, brandVoice.test.js, pagespeed.test.js,
    vision.test.js, compose.test.js — 37 tests total, all passing, all run with Node's
    built-in test runner (`node --test`), zero network/API calls (everything mocked)
    fixtures/diy-wix.html, pro-wordpress.html, ambiguous.html — HTML fixtures for the 3 buckets
```

### How the pipeline works

1. **Module 1 (deterministic, free)** — fetches the lead's HTML, runs `runDeterministicChecks` (platform detection, SSL, tap-to-call, contact form, structured data, staleness) and `fetchPageSpeed` (Google PageSpeed Insights, mobile strategy).
2. **Module 2 (vision)** — captures a mobile-viewport screenshot via Playwright, sends it to Claude (`claude-sonnet-4-6` by default, `claude-haiku-4-5` configurable via `ANTHROPIC_MODEL` env var as a cheaper fallback) with a system prompt that constrains findings to design-era / clutter / branding / stock-photo / above-the-fold-trust / CTA-prominence — never about the owner.
3. **Module 3 (classifier)** — pure function over Module 1 findings only (no AI, fully reproducible): `diy-builder` (builder subdomain or consumer builder platform), `pro-maintained` (WordPress or unrecognized custom build on a custom domain), or `unknown` (conflicting/missing signals, always `confidence: low`, never makes a price-bleed claim).
4. **Module 4 (compose)** — sends all findings + bucket + angle to Claude, gets back `{ email_hook, mini_audit_markdown }`, immediately re-checks both strings against the brand-voice linter and **throws if either fails** — composed copy can never reach disk if it violates voice rules.
5. **Orchestrator** (`scripts/run.js`) — reads `input/leads.csv`, runs all 4 modules per lead, writes `<slug>.json` / `<slug>.email.txt` / `<slug>.mini-audit.md`, and a run-level `index.json` summary. One lead's failure (bad URL, etc.) is caught and logged; it doesn't stop the run.

### Brand voice enforcement

`lib/brandVoice.js` is the single source of truth, used in three places: unit tests, `compose.js` at generation time (hard failure if violated), and available for ad hoc checks. It flags: emojis, the word "bot", "business day(s)", and Title-Case headings (heuristic: >60% of words in a heading capitalized). No price ever appears in the email hook by construction (the prompt explicitly forbids it and Nora is only ever a single soft mention inside the mini-audit, never the email).

### Tests and lint

- `npm test` (audit/) → `node --test test/` → **37/37 passing**, zero network calls (PageSpeed/Anthropic/Playwright are all mocked via dependency injection in the relevant lib functions).
- `npm run lint` (audit/) → `node scripts/lint.js` → passes (syntax-checks every `.js` file in `/audit` via `node --check`; this repo has no shared ESLint config to extend, so this is a deliberately minimal substitute).

## What's left / known limitation

**The orchestrator has not been run against live APIs.** This container has no `ANTHROPIC_API_KEY` or `PAGESPEED_API_KEY` set, and outbound fetch to general internet domains (tested: `example.com`) returns 403 — consistent with this repo's documented pattern that several existing scripts (Scout, Pitcher, Drip, Reporter, Webhook, Poller) must run on Dave's Mac because the container blocks their outbound API calls. The same restriction applies here.

To prove the orchestration logic end-to-end anyway, I ran a separate mocked harness (not committed — it lived in `/tmp` scratchpad, not the repo) that exercises the **real** `htmlChecks.js`, `classifier.js`, and `brandVoice.js` modules against the 3 HTML fixtures already in `test/fixtures/`, with only the network fetch / Playwright screenshot / Anthropic calls mocked. It produced real output files in `audit/output/` (now gitignored, not committed) and confirmed:
- Wix builder-subdomain fixture → `diy-builder` / `high` confidence, correctly detects 2017 copyright as stale.
- WordPress custom-domain fixture → `pro-maintained` / `high` confidence, correctly detects JSON-LD/local-business schema.
- Ambiguous fixture (no platform signature, custom domain) → `pro-maintained` / `medium` confidence (per the classifier's rule: custom domain + no consumer-builder signature defaults to pro-maintained, not unknown — unknown is reserved for genuinely conflicting/missing signals).
- All generated email/mini-audit copy passed the brand-voice linter on first try.

**To actually run this for real (next session, on a machine with network + API keys):**
1. `cd audit && npm install && npx playwright install chromium`
2. Copy `.env.example` to `.env`, fill in `PAGESPEED_API_KEY`, `ANTHROPIC_API_KEY`, `TREVO_SIGNATURE_NAME`.
3. `npm run audit` (runs `scripts/run.js` against `input/leads.csv`) — swap in real has-website lead rows when ready.
4. Spot-check `output/*.email.txt` and `output/*.mini-audit.md` by eye before trusting them for real outreach — this agent still only produces drafts; nothing here sends anything.

## Dependencies added (audit/package.json only — root package.json untouched)
- `@anthropic-ai/sdk` (already used elsewhere in the repo, same version pinned: `^0.37.0`)
- `csv-parse` — leads.csv parsing
- `playwright` — headless Chromium screenshot capture
- `dotenv` (already used elsewhere in the repo)

## Definition-of-done checklist
- [x] `/audit` is fully isolated — zero modifications to Scout/Diagnose/Check/Build/Film/Pitch/Reply/Report/drip.js/webhook.js/state.json/milly.
- [x] ESM throughout, matches repo's Node version (v22, tested against `engines.node >= 18.0.0`).
- [x] Buckets + confidence assigned and recorded on every lead.
- [x] All generated copy passes the brand-voice linter (enforced at generation time, not just tested).
- [x] Unit tests for deterministic checks, bucket classifier (DIY / pro / ambiguous fixtures), and brand-voice linter — all passing.
- [x] Lint passes.
- [x] Dry run produced real output files end-to-end (with network/Anthropic/Playwright mocked — see limitation above).
- [x] Committed to `feature/site-audit` only.
- [ ] **Not done: a true live-API run.** Requires running outside this container (same constraint as Scout/Pitcher/etc.) — see "What's left" above.
- [x] This checkpoint file.
