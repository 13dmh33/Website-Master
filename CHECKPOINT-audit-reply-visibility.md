# CHECKPOINT — session `claude/audit-reply-visibility-f4y05a` (2026-07-18)

> Filed under this name (not the root `CHECKPOINT.md`) because the root
> `CHECKPOINT.md` is the persistent Sheet-Log CRM reference doc and must not be
> clobbered — same precedent as `CHECKPOINT-fix-reel-video-drop.md`.

Branch: `claude/audit-reply-visibility-f4y05a` (off `main`). All work committed.

## Status by task

| Task | Status | Commit / artifact |
|---|---|---|
| 0 — branch housekeeping | done (with one Dave item) | see below |
| 1 — repo-wide audit | **done** | `reports/AUDIT_2026-07-18.md` |
| 2 — reply visibility in poller | **done** | poller intent-classify commit |
| 3 — revert daily_limit to 30 | **done** | config revert commit |
| 4 — drip stall | **diagnosed** (no code change — see why) | in audit + below |
| 5 — wire Stripe | blocked on Dave (task 2 of his list) | not started |
| 6 — engagement analyzer | **Phase 0 reported**, build not started | audit §Task 6 |
| 7 — Nora defects | **blocked** — Nora code not in this repo | n/a |

## Task 0 notes
- `CHECKPOINT-fix-reel-video-drop.md` read: status DONE, no resume, no collision
  with this queue (it touched `miley/scripts/push-queue.js`; task 6 touches
  `molly/lib/*`).
- No unpushed local branches exist in this fresh container (only `main` + this
  branch, both on origin). The "five unpushed local branches" data-loss risk
  from the original session does not apply here.
- `claude/miley-techs4tatas` confirmed fully merged into `main` (0 commits
  ahead). Attempted `git push origin --delete` returned **HTTP 403** — this
  session's push credentials are scoped to the working branch only.
  **Dave: delete it manually** (`git push origin --delete claude/miley-techs4tatas`)
  or from the GitHub UI. It is merged and stale — safe to remove.

## Task 2 — MANUAL VERIFICATION (required by the brief)

The poller now classifies inbound email intent and writes it to `state.json`
additively. To confirm a real inbound reply registers (Mac, where Zoho IMAP is
reachable):

1. Enable IMAP for dave@trevoadvisors.com (Dave's list item 1) — poller cannot
   connect until this is on.
2. On the Mac: `npm install imapflow mailparser` (poller now needs mailparser too).
3. From a *different* email account that matches a lead's email in
   `queue/*-brief.json`, send a reply into the Zoho inbox. Try three bodies to
   exercise routing:
   - "How much does it cost?" → expect intent `positive` → state `replied`.
   - "Please remove me" → expect intent `negative` → state `unsubscribed`.
   - "Out of office" as the subject → expect `auto_reply`, no status change.
4. Run: `node scripts/poller.js --dry-run`  (prints the intent + would-be status,
   writes nothing). Then `node scripts/poller.js` to apply.
5. Confirm in `state.json`: the lead's `queue[]` entry now has `status`
   (`replied`/`unsubscribed`/`on_hold`), plus new additive fields
   `reply_intent`, `reply_confidence`, `reply_channel:"email"`, and
   `reply_received_at`. Confirm `messages/<lead>-sent.json` gained
   `reply_intent`/`reply_confidence`/`replied_at` and a pushed `replies[]` entry.
6. If nothing registers: the message wasn't matched to a lead (sender email must
   equal `brief.email`, normalized lowercase), or was filtered as an auto-reply —
   check `logs/poller-YYYY-MM-DD.log`, which logs every skip with a reason.

**Do NOT cron both `poller.js` and `reply-agent.js` on the same inbox**
(`scripts/poller.js:3` — reply-agent supersedes it). Pick one. If you want
human-reviewed Claude drafts, run reply-agent; if you want zero-cost
keyword-classified auto-status, run this poller.

## Task 3 — reasoning
Confirmed `config/checker-config.json` daily_limit was 120 and
`config/pitcher-config.json` is 30 (4× ratio). The checked-to-sent backlog is
**arithmetic, not a leak**: Checker approves ~4× faster than Pitcher sends.
Reverted checker + diagnoser `daily_limit` to the documented **30**; monthly
dollar caps and the Pitcher cap left untouched. Merlin's framing of the backlog
as "the largest available lever" is wrong — the lever is the read path (task 2)
and the drip (task 4), not more approvals.

## Task 4 — drip stall: diagnosis, no code change (deliberate)
Full evidence in `reports/AUDIT_2026-07-18.md` §Drip. Summary: the
queue-advancement logic in `scripts/drip.js` is **correct** (verified against
fixtures — d1→d1b→d1c→d2 advances, cadence gate holds, no phantom sends; all
templates present; pitcher/drip field names match). The stall is **operational**:
`18+1+0 = 19` total drip messages ≈ one run at `daily_limit 20`; `last_run: null`;
zero `drip_*` statuses in state. drip is `auto_run:false`, Mac-only, and
`setup-cron.js` only *prints* the 9am cron for manual paste.

**Remediation (Dave, Mac):**
1. Install the drip cron: `node scripts/setup-cron.js`, then `crontab -e` and
   paste the "Drip Campaign (9am daily)" line. Confirm with `crontab -l`.
2. First catch-up run will be slow: ~147 leads are all overdue at once and
   `daily_limit` is 20/day, so full drain of d1→d2 takes several weeks. If you
   want faster catch-up, raise `config/drip-config.json` `daily_limit` temporarily
   (deliverability permitting) — but only after task 2's read path proves replies
   are being captured, so drip doesn't keep emailing people who already replied.
3. Known secondary gap (out of scope this session): drip does not skip
   `reply_drafted`/`unsubscribed` (`scripts/drip.js:135`) — the deferred
   campaign-exit work. Until that lands, make sure poller/reply-agent are marking
   repliers before you widen drip, or you will drip people who replied.

No code was changed for task 4 because changing a verified-correct function to
paper over a missing cron would be wrong.

## Task 6 — Phase 0 reported, build NOT started
See `reports/AUDIT_2026-07-18.md` §Task 6. Headlines for whoever builds it:
- No shared sibling lib exists — build `engagement/` at root, three named brand
  targets, all three consume it. Do not fork per-sibling.
- `molly/lib/instagram-insights.js` is real + read-only; extend its shape, don't
  rebuild. No Reels metrics, no LinkedIn — add adapters.
- **Hardest part: the join.** No sibling stores the posted IG `media_id`/permalink
  on the generation record, and the three content-log schemas differ (Miley flat
  array vs Molly nested `posts[]`). Join by caption+timestamp; read each sibling's
  real field names, invent none. Settle this design before coding.
- Respect the knowledge-isolation rule: touch no CLAUDE.md/template/brand file.

## Decision for Dave (do not implement without a call)
**Molly automation.** Molly is the only sibling marketing a paying business yet
the only one with no CLAUDE.md and no workflow. Giving it a scheduler now would
just automate never-engagement-tested posting. Sequence after task 6 returns a
Molly engagement report, or after you decide Molly's content is good enough to
run unattended. (Brief's explicit "deliberately not in this queue" item.)

## Not done / rolls forward
- Task 5 (Stripe) — blocked on Dave's Payment Links + `STRIPE_SECRET_KEY`.
- Task 6 build — large, Phase 0 done, code not started.
- Task 7 (Nora) — blocked: Nora's product code is not in this repo (only upsell
  references). Commit Nora to a branch here before it can be audited/fixed.
- Also surfaced: `funnel-dashboard`, `tatas-token-refresh`, `miley-token-refresh`
  workflows are **failing** in Actions history — not investigated this session.

---

## Ready-to-paste continuation prompt

> Continue the `claude/audit-reply-visibility-f4y05a` session. Tasks 0-4 and the
> task-6 Phase 0 recon are done and committed; read
> `CHECKPOINT-audit-reply-visibility.md` and `reports/AUDIT_2026-07-18.md` first.
> Next, build Task 6 (the shared engagement analyzer) per the brief: one
> `engagement/` module at repo root with three separately-callable brand targets
> (Molly/Milly/Miley), read-only against Meta, a `--fixtures` path, the ≥20-post
> gate and per-attribute ≥5/side denominators, three never-pooled dated reports in
> `engagement/reports/`. Resolve the caption+timestamp join design first (no stored
> media_id — see audit §Task 6). Modify no CLAUDE.md/template/brand file. If Dave
> has supplied Stripe Payment Links + `STRIPE_SECRET_KEY`, do Task 5. Leave Task 7
> (Nora) until Nora's code is committed to a branch in this repo. Commit atomically,
> one task per commit, and keep this checkpoint current.
