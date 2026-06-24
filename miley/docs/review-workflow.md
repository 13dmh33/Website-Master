# Weekly Review Workflow — Techs4Tatas

This is your once-a-week routine. The engine does the work; you approve before anything goes live. Budget ~20-30 minutes.

## How it works (plain version)

The pipeline never posts on its own. It writes the week's content to a queue and builds a preview you can open in a browser. Nothing reaches Instagram until **you** approve it. That's controlled by one setting — `FORCE_QUEUE=1` — which stays ON permanently.

## The rhythm

1. **Thursday** — the engine generates and renders next week's posts, then writes them to `output/queue/` with a preview file: `output/queue/preview-{date}.html`.
2. **Thursday–Sunday** — you review whenever you have a few minutes:
   - Open the `preview-{date}.html` file in your browser. You'll see every post (image + caption) for the week.
   - While you're there, glance at 1-2 news sources (see below) for a fresh angle worth swapping in.
3. **Edit anything you don't love** (see "How to fix a post" below).
4. **Approve** — run `scripts/push-queue.js`. This sends the approved week to Buffer, which posts each one automatically at its scheduled time the following week.

That's it. Skip a week? The previous content just stays queued — nothing posts without your approval.

## How to fix a post

You have three levers, easiest first:

- **Quick wording tweak:** edit the post directly in the queue JSON (`output/queue/`) before approving. Fastest for typos or a punchier hook.
- **Swap in a different fallback:** every content type has backups in `evergreen.json`. Copy one over.
- **Permanent change:** if something's consistently off — voice, a CTA, a hashtag set — edit the matching config file (`brand-voice.json`, `hashtag-master.json`, etc.) so every future week improves. This is the real payoff of reviewing weekly: the files get smarter over time.

## Finding fresh news angles (5 min)

Open one or two of these and look for a stat, a milestone, or a story worth a post. Pull the *idea*, then write it in your own voice — never copy their text.

**Women in trades:** BLS.gov · NAWIC.org · Chicago Women in Trades · CNBC · NPR
**Breast cancer (mission/October):** cancer.org (American Cancer Society) · nationalbreastcancer.org · bcrf.org

Full list with notes is in `inspiration-sources.json`.

## October note

October is daily (7 posts/week). Generate a week ahead and approve all 7 in one sitting. Same routine, just a fuller preview.

## One-time setup checklist

- [ ] `FORCE_QUEUE=1` set as a repo secret / env var (keeps everything review-first)
- [ ] Buffer **GraphQL personal API key** connected (from developers.buffer.com → Get an API Key — Buffer no longer issues classic v1 tokens)
- [ ] You know how to open the HTML preview and run `push-queue.js` (Claude Code will document the exact command)
- [ ] Confirm with Claude Code that `push-queue.js` preserves the scheduled times (posts later) rather than posting immediately on approval
