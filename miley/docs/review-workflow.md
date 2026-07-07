# Weekly Review Workflow — Techs4Tatas

This is your once-a-week routine. The engine does the work; you approve before anything goes live. Budget ~20-30 minutes.

## How it works (plain version)

The pipeline never posts on its own. It writes the week's content to a queue and builds a preview you can open in a browser. Nothing reaches Instagram until **you** approve it. That's controlled by one setting — `FORCE_QUEUE=1` — which stays ON permanently.

## The rhythm

1. **Thursday** — the engine generates and renders next week's posts, writes them to `output/queue/`, and publishes the preview to **https://trevoadvisors.com/review/miley/** (also saved locally as `output/queue/preview-{date}.html`).
2. **Thursday–Sunday** — you review whenever you have a few minutes, from any device:
   - Open the review page (or the local preview file). You'll see every post (image + caption) for the week.
   - While you're there, glance at 1-2 news sources (see below) for a fresh angle worth swapping in.
3. **Edit anything you don't love** (see "How to fix a post" below).
4. **Approve** — open the **"Miley approve week"** workflow on GitHub (Actions tab, works from the GitHub phone app) and tap **Run workflow**. Leave the inputs blank to approve the whole week, or list slots to skip. The `miley-post-due` cron then posts each one directly to Instagram at its slot time — no Buffer, no Mac.
   - Command-line equivalent: `node scripts/approve-week.js` (then `node scripts/post-due.js` runs on cron).
   - Legacy path: `scripts/push-queue.js` still releases to Buffer if you ever need it.

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
- [ ] Meta app created with use case **Instagram** → "Instagram API with Instagram Login" (**no Facebook Page link needed**; Development mode is fine). In the dashboard's "API setup with Instagram login", connect @techs4tatas (must be a professional account — Business or Creator) and generate the long-lived token; the account ID is shown right there.
- [ ] `INSTAGRAM_ACCESS_TOKEN` (long-lived) + `INSTAGRAM_BUSINESS_ACCOUNT_ID` added as GitHub Actions secrets — these power both posting and analytics
- [ ] `GH_SECRETS_PAT` secret (fine-grained PAT, "Secrets: read and write" on this repo) so the miley-token-refresh workflow can auto-renew the 60-day token
- [ ] `SOCIAL_BASE_URL` repo variable set (defaults to https://trevoadvisors.com) and the Netlify site deploying `website/`
- [ ] You've found the "Miley approve week" workflow in the GitHub Actions tab (that's your approve button)
- [ ] (Legacy fallback only) Buffer **classic** token, if you ever want `push-queue.js`

## Post lifecycle (for debugging)

`pending` (generated, awaiting review) → `approved` (you tapped approve) → `posted` (live on IG, `igMediaId` recorded). A failing post retries up to 3 runs then becomes `failed`; anything more than 72h overdue becomes `stale` and will NOT quietly post late. Check status anytime: `cd miley && node scripts/approve-week.js --list`. Failures automatically open a GitHub issue.
