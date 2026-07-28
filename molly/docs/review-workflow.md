# Weekly Review Workflow — Trevo Advisors

This is your once-a-week routine for Molly. The engine does the work; you
approve before anything goes live. Budget ~15-20 minutes.

## How it works (plain version)

The pipeline never posts on its own. It writes the week's content to a queue
and builds a preview you can open in a browser. Nothing reaches Instagram
until **you** approve it. That's controlled by one setting —
`FORCE_QUEUE=1` — which stays ON permanently.

## The rhythm

1. **Monday** — the engine researches, generates, and renders the week's 4
   posts (carousel Tue, caption Thu, "Trevo built this" Sat, reel Sun), then
   writes them to `output/queue/` with a preview file:
   `output/queue/preview-{date}.html`.
2. **Monday–Wednesday** — review whenever you have a few minutes:
   - Open the `preview-{date}.html` file in your browser. You'll see every
     post (image or reel video + caption) for the week.
   - The reel post plays inline as a real video — review it like any other
     post, not just its cover image.
3. **Edit anything you don't love** (see "How to fix a post" below).
4. **Approve** — run `scripts/push-queue.js`. This sends the approved week to
   Buffer, which posts each one automatically at its scheduled time.

That's it. Skip a week? The previous content just stays queued — nothing
posts without your approval.

## How to fix a post

You have three levers, easiest first:

- **Quick wording tweak:** edit the post directly in the queue JSON
  (`output/queue/`) before approving. For the reel, edit `hook`/`body`/`cta`
  (the on-screen lines) or `caption` (the Instagram caption) — but note the
  video itself won't reflect a hand-edit to `hook`/`body`/`cta` unless you
  re-run `node agents/designer.js` after editing the content JSON (not the
  queue JSON) and then `node agents/scheduler.js` again.
- **Swap in a different fallback:** every content type has backups in
  `evergreen.json`. Copy one over.
- **Permanent change:** if something's consistently off — voice, a CTA, the
  reel style rotation — edit the matching config file (`brand-voice.json`,
  `lib/planner.js`'s `REEL_STYLES`, etc.) so every future week improves.

## Calendar context

`templates/calendar.json` + `lib/calendar.js` surface date-specific
observances (National Skilled Trades Day, Small Business Week, seasonal
planning windows) that `lib/planner.js` folds into the week's prompts as
extra context — never a forced topic, just an available angle. Check
`output/briefs/brief-{date}.json` or the generator's console output
(`Calendar context: <name>`) to see if one fired this week.

## One-time setup checklist

- [ ] `FORCE_QUEUE=1` set as a repo secret / env var (keeps everything
      review-first)
- [ ] Buffer **classic** token connected (not the MCP/OIDC one — it silently
      fails)
- [ ] You know how to open the HTML preview and run `push-queue.js`
- [ ] Confirm `push-queue.js` preserves the scheduled times (posts later)
      rather than posting immediately on approval
