# CHECKPOINT — branch reconciliation session (2026-07-19)

> Filed under this name, not root `CHECKPOINT.md` or `CHECKPOINT-branch-reconcile-2026-07-18.md`
> (that one is the prior session's record, left intact).

Continuing the 14-task "reconcile branches, unblock the funnel, fix Merlin" plan.

## Status by task

| Task | Status | Commit |
|---|---|---|
| 0 — pre-merge safety + branch inventory | done | (no commit) |
| 1 — collision check (repeated per branch) | done, ongoing per-branch | (report only) |
| 2 — verify piper-scope/molly-brand-voice already merged | confirmed (prior session) | n/a |
| 3 — rebase/merge audit branch | **done** | `f383624` |
| 4 — resolve remaining branches | **partially done, one open question** | `ca75a0d` |
| 5 — schedule drip.js | not started | — |
| 6 — CAN-SPAM audit + suppression gate | not started | — |
| 7 — verify evergreen quarantine (Phase-0) | not started | — |
| 8 — verify state.json protection (Phase-0) | not started | — |
| 9 — wire Stripe | blocked on Dave | — |
| 10 — fix Merlin's blind spots | not started | — |
| 11 — fix Merlin's session-prompt generation | not started | — |
| 12 — verify cron failure alerting (Phase-0) | not started | — |
| 13 — correct AUDIT_2026-07-18.md | not started | — |
| 14 — fix-or-delete Strategy dashboard | not started | — |

## Task 0 — branch inventory (local, before this session's work)

12 local refs (11 branches + main). Ahead/behind vs `main`:

```
claude/email-agent-scope-audit-ku4pkc: +1 / -39
claude/job-hunter-pipeline-kbzs75:     +9 / -43   (deliberately isolated, out of scope)
claude/kind-hypatia-3YzM0:             +3 / -229
claude/miley-techs4tatas:              +4 / -94
claude/weekly-email-revenue-plan-4ysmqx: +17 / -70
feature/funnel-metrics:                +0 / -28   -> fully merged, deleted
feature/merlin-advisor:                +0 / -10   -> fully merged, deleted
feature/nora-multichannel-config:      +8 / -35   -> see Task 4
feature/post-call-proposal:            +13 / -35
feature/session-2026-07-18:            +0 / -29   -> fully merged, deleted
tech4tatas-heat-content:               +2 / -29
```

`feature/merlin-advisor` still existed locally despite a `git branch -d` earlier in the
prior session (turned out that delete never actually landed, no mystery). Re-verified it
was a genuine ancestor of `main` (`git merge-base --is-ancestor` = true) and deleted it,
along with `feature/funnel-metrics` and `feature/session-2026-07-18` (both also confirmed
ancestors of `main` — zero unique commits, safe local cleanup).

## Task 3 — audit branch, in full

Same collision pattern as the 07-18 checkpoint documented: `claude/audit-reply-visibility-f4y05a`'s
`state.json`/`config/cost-log.json` are a stale pre-recovery baseline, not a real conflicting
edit. This session's own plan text pre-authorized the resolution ("resolve in favor of main")
directly in Task 3's description, so proceeded without a fresh confirmation gate.

Merged via `git merge --no-ff` (not rebase — safer, no history rewrite). Git's own 3-way
merge required zero manual resolution on either file — confirmed post-merge via diff
(`state.json`/`cost-log.json` byte-identical to pre-merge `main`, queue length still 645).
Brought in: `scripts/poller.js` opt-out/reply-classifier wiring, `checker-config.json` +
`diagnoser-config.json` daily_limit reverted 120/100 → 30 (closes the outstanding CLAUDE.md
action item), `reports/AUDIT_2026-07-18.md` (correction pending, Task 13),
`CHECKPOINT-audit-reply-visibility.md`. Pushed to origin (`f383624`).

## Task 4 — remaining branches

**`feature/nora-multichannel-config`** — diff showed the identical stale-baseline collision
AND the branch predates essentially all of this session's + the prior session's other merges
(Merlin, Molly brand-voice, evergreen quarantine, cron alerting, funnel-metrics all show as
"deletions" in the branch's diff, since the branch was cut before they existed). A full
merge/rebase would have fought all of that. Instead of merging the branch, **cherry-picked
only its genuinely new, self-contained payload**: the entire `nora/` directory (new — main
had none of it), plus the two real non-stale edits buried in the noise (`.gitignore`'s
nora-runtime-data block, `package.json`'s `nora:test`/`nora:server` scripts). Left alone:
`state.json`, `cost-log.json`, `config/pitcher-config.json`, `config/template-stats.json`,
`CLAUDE.md` (branch's copy is a stale reversion — main's is current), and everything the
branch would have *removed* relative to main (Merlin, Molly, funnel-metrics, etc. — all
still correctly present on main). 46 nora tests passing post-integration. Added a
discoverability section to root `CLAUDE.md` (Nora joins the Milly/Miley/Reeve/Strategy
subdirectory-doc pattern). Committed + pushed (`ca75a0d`).

Local branch `feature/nora-multichannel-config` deleted (`git branch -D`, since after the
narrow cherry-pick it's correctly *not* a full ancestor of main — the rest of its diff was
deliberately not applied). **Remote copy at `origin/feature/nora-multichannel-config` was
left untouched** — nothing pushed a deletion there, so the branch's full original history
remains recoverable if anything else in it is ever needed.

**`claude/email-agent-scope-audit-ku4pkc` — found something that needs Dave's call, not
resolved:** this branch is only 1 commit ahead of main: `8ce5301 "Campaign-exit on reply +
revert daily_limits."` Root `CLAUDE.md`'s own Action Items section currently says:

> **Campaign-exit on reply (scoped 2026-07-17, NOT built — stopped per owner):** ...

i.e. the living doc says Dave said don't build this. But this branch has a commit that
appears to build exactly that (title matches precisely). Did not merge it, did not
investigate further, did not touch this branch. **This needs Dave to confirm**: was the
"stopped per owner" note accurate and this branch should be discarded, or did an earlier
session build it before/without that instruction and it's actually fine to bring in now?
Flagging rather than guessing given the direct contradiction with an explicit standing
instruction.

**Not touched, out of this session's named scope** (Task 4 only named
`feature/nora-multichannel-config`, `feature/funnel-metrics`, `feature/session-2026-07-18`):
`claude/job-hunter-pipeline-kbzs75` (deliberately isolated per repo convention — never
touch), `claude/kind-hypatia-3YzM0`, `claude/miley-techs4tatas`,
`claude/weekly-email-revenue-plan-4ysmqx`, `feature/post-call-proposal`,
`tech4tatas-heat-content`. Left exactly as found.

## Ready-to-paste continuation prompt

```
Continue the 2026-07-19 "reconcile branches, unblock the funnel, fix Merlin" session.
Read /CHECKPOINT-branch-reconcile-2026-07-19.md first — tasks 0, 3, 4 are done and pushed
to main (commits f383624, ca75a0d). One open question from task 4: does Dave want the
"Campaign-exit on reply" commit on claude/email-agent-scope-audit-ku4pkc (8ce5301)? It
contradicts CLAUDE.md's own "stopped per owner" note for that exact feature — get an
explicit answer before touching that branch either way.

Proceed with task 5 (schedule drip.js — but ONLY after verifying the poller/reply-agent
opt-out classification that just landed in task 3 actually works; do not enable if
unverified), then 6 through 14 in order per the original plan.

Standing rule (root CLAUDE.md): verify no pipeline process is running before any
checkout/stash/merge/rebase, every session.
```
