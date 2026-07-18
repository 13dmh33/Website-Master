# CHECKPOINT — branch reconciliation session (2026-07-18)

> Filed under this name, not the root `CHECKPOINT.md` — that file is the persistent
> Sheet-Log CRM reference doc and must not be clobbered, same precedent as
> `CHECKPOINT-fix-reel-video-drop.md` and `CHECKPOINT-audit-reply-visibility.md`.

Work done directly on `main` (per the session's own instruction) plus one dedicated
branch for task 6. All work pushed to origin.

## Status by task

| Task | Status | Commit |
|---|---|---|
| 0 — pre-merge safety | done | (no commit — as instructed) |
| 1 — collision check | **done, found a real collision, stopped** | (report only) |
| 2 — merge piper-scope + molly-brand-voice | done | `b696df3` |
| 3 — rebase/merge audit branch | **blocked on task 1** | not started |
| 4 — correct audit report | **blocked on task 3** | not started |
| 5 — schedule drip.js | **blocked on task 3** (needs poller opt-out classification) | not started |
| 6 — quarantine evergreen + validator | done | `d516c62` |
| 7 — protect state.json/cost-log.json | done (Option B, Dave hasn't picked) | `9e7f1d6` |
| 8 — cron failure alerting | done | `3e2dacb` |
| 9 — merge/close feature/session-2026-07-18 | **blocked on tasks 2+3** | partially assessed |

## Task 1 — the collision, in full

```
git diff main..claude/audit-reply-visibility-f4y05a -- state.json config/cost-log.json
```

Not empty. `state.json`: audit branch has 293 queue entries vs. `main`'s recovered 645.
`config/cost-log.json`: audit branch is missing 5,460 lines of history `main` has.

**Root cause, not a new conflicting edit:** the audit-branch session ran in a fresh
container cloned before this session's pitcher-recovery commit (`38ba82b`) existed. Its
`state.json`/`cost-log.json` are simply inherited unchanged from an older base — the
audit branch's own 4 commits (revert daily_limit, poller.js, the audit report, its
checkpoint) never touch either file directly.

**Per task 1's explicit instruction, this session stopped rather than resolving it** —
even though task 3's own text already prescribes the resolution ("resolve any conflict
in favor of main — main holds the recovered data"), task 1 conditions task 3 on the
diff coming back clean, which it didn't. Treating that as deliberate: a second
confirmation gate given the actual data-loss incident this same collision pattern
already caused once. Reported to the user; awaiting explicit go-ahead before task 3
proceeds with the rebase using main's version of both files.

## What's done

- **Task 0**: confirmed no pipeline process running (`ps aux` check), backed up
  `state.json` + `config/cost-log.json` to the scratchpad dir (outside the repo
  entirely, not just gitignored — avoided touching `.gitignore` since task 0 says
  commit nothing), confirmed `main` was clean.
  - **Found along the way**: `main`'s working tree was unexpectedly already clean —
    traced to `stash@{0}` ("Pre-branch-reconcile: pipeline work...") from the earlier
    pitcher-corruption-recovery incident, still holding ~465 lines of legitimate
    pre-existing uncommitted work (`CLAUDE.md` edits, scout/contact-scraper fixes,
    dozens of `queue/*-brief.json` updates) that was never restored after that
    emergency. **Still sitting in the stash, not lost, not yet restored** — see
    "What's next."
- **Task 2**: both zero-conflict branches merged cleanly (fast-forward for
  `piper-scope`, three-way for `molly-brand-voice`), pushed, local branches deleted.
  Neither had ever been pushed to origin individually, so no remote branch cleanup
  was needed for either.
- **Task 6** (`feature/molly-evergreen-quarantine`, merged to `main`):
  `templates/evergreen.json` → `quarantine/evergreen-prespec.json` (moved, not
  deleted — real drafting material). New `lib/brand-validator.js`, 10 checks against
  `molly/CLAUDE.md`'s rules, wired as a hard gate in both `agents/scheduler.js`
  (before either the Buffer-auto-post or review-queue branch) and
  `scripts/push-queue.js` (defense in depth, right before the live Buffer call).
  Live-verified against real data: all 19 posts in the quarantined library fail
  validation — proves the gate catches the content it exists to stop, not just
  synthetic test cases. A first pass let 4 real posts through (plain number+noun
  statistics like "8 seconds"/"12 reviews" that the original %-only pattern missed);
  broadened the check and re-verified before committing. Confirmed Molly's posting
  path stays disabled independent of the gate too: no GitHub Actions workflow exists
  for `molly/`, `BUFFER_ACCESS_TOKEN` unset in `molly/.env`.
- **Task 7**: Dave hasn't picked between the two protection options yet. Implemented
  the fallback (Option B: no code change) — added the standing rule to root
  `CLAUDE.md`'s Orchestration Rules (not just this checkpoint, so it survives past
  this session and is read at the start of every future one), with Option A noted as
  still open.
- **Task 8**: `scripts/notify-workflow-failure.js`, live-verified with a real Zoho SMTP
  send before wiring in. Added as a final `if: failure()` step to all 5 scheduled
  workflows that exist on `main` (Reeve's is the one currently actually failing on
  `SERPAPI_KEY`, per the audit branch's findings — this should start alerting on it
  once merged and next triggered). Each workflow also gained a root `npm install`
  step since the notifier needs root's `nodemailer`, which none of them previously
  installed.

## What's blocked, and exactly what unblocks it

**Tasks 3, 4, 5, 9 all wait on one decision:** confirm it's correct to rebase
`claude/audit-reply-visibility-f4y05a` onto current `main` and resolve `state.json`/
`config/cost-log.json` in favor of `main`'s versions (i.e., the audit branch's stale
copies of those two files are discarded, everything else it changed — the poller
wiring, the config revert, the audit report — is kept). This is very likely correct
(explained under "root cause" above) but per task 1's own instruction this session
did not do it unilaterally.

Once confirmed:
- **Task 3**: rebase, resolve, merge, push, delete branch. Brings in the poller/
  reply-classifier wiring and the reverted daily limits (already independently
  matches what `main` needs — the checker/diagnoser limits on `main` were never
  reverted by this session either, since that fix lives only on the blocked branch).
- **Task 4**: correct `reports/AUDIT_2026-07-18.md` in place — it says Nora and
  Merlin have no code in the repo, which was true for that container at the time but
  is a branch-isolation artifact, not a repo fact: both exist on
  `feature/nora-multichannel-config` and `feature/merlin-advisor`, neither merged to
  `main` yet. Annotate, don't delete, add a "verified from" scope note.
- **Task 5**: schedule `drip.js`. Its own explicit precondition — confirm the poller's
  opt-out classification (task 3's payload) actually works before enabling — can't be
  checked until task 3 lands. **Do not enable the schedule if unverified**, per the
  task's own hard rule.
- **Task 9**: check whether `feature/session-2026-07-18`'s partial Task 0 work
  (CHECKPOINT read, most branches pushed, `claude/weekly-email-revenue-plan-4ysmqx`
  still needing its merge) is now redundant given tasks 2+3; merge what's unique,
  delete if not.

## Not yet done, not blocked, just not reached

- Restoring `stash@{0}`'s ~465 lines of legitimate pre-existing work onto `main` (see
  Task 0 note above). Safe where it is, but shouldn't sit indefinitely — a stash is
  easy to lose track of over many sessions.
- Dave's list items (SERPAPI_KEY, IMAP, Stripe, the task 7 decision) — none of these
  are Claude Code's to do, noted here only so the continuation prompt doesn't miss
  that they're still open.

## Ready-to-paste continuation prompt

```
Continue the branch-reconciliation work. Read /CHECKPOINT-branch-reconcile-2026-07-18.md
first — tasks 0, 2, 6, 7, 8 are done and pushed to main. Tasks 3, 4, 5, 9 are blocked on
one confirmation: is it correct to rebase claude/audit-reply-visibility-f4y05a onto
current main and resolve state.json/config/cost-log.json in favor of main's versions
(discarding the audit branch's stale 293-entry state.json and truncated cost-log.json,
keeping everything else it changed)? If yes, proceed with task 3 exactly as originally
scoped (rebase, resolve, merge, push, delete branch), then 4, 5, 9 in order — task 5 has
its own hard precondition (verify the poller's opt-out classification actually works
before enabling the drip schedule; do not enable if unverified).

Also restore stash@{0} ("Pre-branch-reconcile: pipeline work...") onto main before it
gets lost track of across further sessions — it holds ~465 lines of legitimate
pre-existing uncommitted work (CLAUDE.md edits, scout/contact-scraper fixes, queue
brief updates) that predates this whole reconciliation effort.

Standing rule now in root CLAUDE.md's Orchestration Rules: verify no pipeline process
is running before any checkout/stash/merge/rebase, every session.
```
