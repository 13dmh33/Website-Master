# CHECKPOINT — branch reconciliation session (2026-07-19)

> Filed under this name, not root `CHECKPOINT.md` or `CHECKPOINT-branch-reconcile-2026-07-18.md`
> (that one is the prior session's record, left intact).

Continuing the 14-task "reconcile branches, unblock the funnel, fix Merlin" plan.

## Status by task

| Task | Status | Commit |
|---|---|---|
| 0 — pre-merge safety + branch inventory | done | (no commit) |
| 1 — collision check (repeated per branch) | done, per-branch | (report only) |
| 2 — verify piper-scope/molly-brand-voice already merged | confirmed (prior session) | n/a |
| 3 — rebase/merge audit branch | **done** | `f383624` |
| 4 — resolve remaining branches | **done, one open question for Dave** | `ca75a0d` |
| 5 — schedule drip.js | **explicitly blocked, reason recorded** | — |
| 6 — CAN-SPAM audit + suppression gate | **done** (gate built; legal copy reported, not added) | `38c9bba` |
| 7 — verify evergreen quarantine (Phase-0) | **verified intact** | n/a |
| 8 — verify state.json protection (Phase-0) | **verified intact** | n/a |
| 9 — wire Stripe | blocked on Dave | — |
| 10 — fix Merlin's blind spots | **done** | `6df19c1` |
| 11 — fix Merlin's session-prompt generation | **done** | `6df19c1` |
| 12 — verify cron failure alerting (Phase-0) | **verified intact (all 5)** | n/a |
| 13 — correct AUDIT_2026-07-18.md | **done** | `8ada509` |
| 14 — fix-or-delete Strategy dashboard | **done — reads live, not stale; corrected audit** | `5f38c5d` |

## Task 5 — drip.js: explicitly blocked, not scheduled (two independent reasons)

The opt-out precondition the plan required IS met: `reply-classifier.js` correctly
routes STOP/unsubscribe/"remove me"/"not interested" to `unsubscribed` (verified live),
and this session's new `scripts/lib/suppression.js` gate makes both Pitcher and drip skip
any suppressed lead (verified — a real unsubscribed lead is excluded from both dry-runs).
So drip would respect opt-outs. It still must not be enabled yet:

1. **drip.js is Mac-only.** Zoho SMTP + Twilio are both blocked from the container
   (CLAUDE.md lines 207/250). It cannot be a GitHub Actions cron like Merlin/Miley/Milly —
   those run in the container. "Scheduling" it means a launchd/cron entry on Dave's Mac,
   which can't be created from here.
2. **CAN-SPAM legal gap (Task 6) is a hard blocker regardless of channel.** No outreach
   template has an opt-out mechanism or physical postal address. Automating follow-up
   email at volume without those is a violation. Drip stays off until Dave supplies the
   copy (see Task 6).

**Ready-to-use Mac cron for when Dave unblocks CAN-SPAM** (conservative daily cap already
in drip-config.json; runs after the morning poller so opt-outs are marked first):
```
# 8:30am daily — after the 4x/day poller has marked any overnight opt-outs
30 8 * * *  cd /Users/davidhettinger/Website-Master && /usr/local/bin/node scripts/drip.js --force >> logs/drip-cron.log 2>&1
```

## Task 6 — CAN-SPAM audit + suppression gate (done)

Built `scripts/lib/suppression.js` — one `isSuppressed(leadId)` check reading state.json
(the canonical store every opt-out path already writes to). Wired as a hard gate into
`pitcher.js` (loadApprovedBriefs) and `drip.js` (loadDripQueue + markUnresponsive — the
latter previously could silently overwrite an `unsubscribed` status to `unresponsive`,
erasing the opt-out). Verified against a real unsubscribed lead. **Legal copy reported,
NOT added** per instruction: 0 of ~23 templates (e1-e7, s1-s8, drip d1/d1b/d1c/d2 x2
channels, referral.js partner lanes) contain an opt-out mechanism or physical address.
Dave must supply both before any live send resumes.

## Tasks 7, 8, 12 — Phase-0 verifications (all intact from prior session)

- **7:** `molly/quarantine/evergreen-prespec.json` present, `store.js` points at it,
  `validateQueue` gates both `scheduler.js` and `push-queue.js`, 13 validator tests pass.
- **8:** the "no branch op while pipeline runs" rule is in CLAUDE.md's Orchestration
  Rules (Option B). Option A still open pending Dave.
- **12:** `notify-workflow-failure.js` wired as an `if:failure()` step in all 5 scheduled
  workflows (miley x2, milly x2, reeve). Merlin's workflow gained the same step this
  session.

## Tasks 10 + 11 — Merlin fixes (done, `6df19c1`)

Full detail in the commit message and `merlin/CLAUDE.md`. Net effect: Merlin's top
recommendation flipped from the confidently-wrong "clear the 436-lead backlog" to
"add STRIPE_SECRET_KEY," because the backlog is now superseded by the seeded
`backlog-is-arithmetic` decision and three already-done candidates (nora merge, poller
fix, daily-limit revert) are auto-retired by live all-branch repo-facts. Stalled-stage
scoring surfaces the drip-never-runs stall; session prompts now split Dave-vs-Claude-Code
tasks. 58 Merlin tests pass. New files: `merlin/decisions.json`, `merlin/lib/decisions.js`,
`merlin/lib/repo-facts.js`, `merlin/last-funnel.json` (+ 2 test files).

## Tasks 13 + 14 — audit corrections (done)

- **13** (`8ada509`): annotated Nora §2 and Merlin §8 in `reports/AUDIT_2026-07-18.md` in
  place (branch-isolation artifacts — both are on main now), top banner + per-section
  `[CORRECTED 2026-07-19]` notes, originals left legible.
- **14** (`5f38c5d`): Strategy dashboard reads LIVE from `reeve/output/*` (grep-confirmed
  zero state.json refs), correctly reports $0 MRR / 0 clients (Reeve has none yet) — not a
  stale fixture as the audit claimed. No fix/deletion needed; corrected audit §7.

## Still open for Dave (not Claude Code's to do)

- **Task 9 (Stripe):** needs live Payment Link URLs + `STRIPE_SECRET_KEY`.
- **Task 6 legal copy:** opt-out wording + physical postal address for every template.
- **Task 5 unblock:** once the above land, add the Mac cron above.
- **Task 4 open question:** does the "Campaign-exit on reply" commit
  (`claude/email-agent-scope-audit-ku4pkc` @ `8ce5301`) get merged or discarded? It
  contradicts CLAUDE.md's own "stopped per owner" note for that exact feature.
- Standing blockers unchanged: Zoho IMAP enable, Twilio A2P 10DLC, SERPAPI_KEY,
  state.json protection Option A decision.

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
