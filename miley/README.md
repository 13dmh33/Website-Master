# Miley

Automated Instagram content engine for **Techs4Tatas** — funny, high-quality apparel celebrating women in the skilled trades. **30% of every profit funds breast cancer research.** Brand voice: "Riley Brooks" (anonymous).

Sibling of Milly (Reeve) and Molly (Trevo): same pipeline, different brand brain.

```
Researcher → Generator → Designer → Scheduler → Analyst
```

**Review-first:** with `FORCE_QUEUE=1` nothing auto-posts. Each run writes the week to `output/queue/` + a browser preview. You approve with `scripts/push-queue.js`, which schedules to Buffer at each slot. See `docs/review-workflow.md`.

## Quick start

```bash
cd miley
npm install
cp .env.example .env          # fill in keys (or leave blank to dry-run free)
node scripts/setup.js
node scripts/test-pipeline.js  # full dry run, never posts
# open output/queue/preview-<week>.html
```

Without `ANTHROPIC_API_KEY`, the pipeline uses the 36-post evergreen bank (zero spend). With a Claude key it generates fresh posts via `agents/generator-prompts.js` and falls back to evergreen on any quality miss.

## Sales funnel

The engine drives traffic to the shop and measures it (all free):

```bash
node scripts/build-linkpage.js                   # generate the link-in-bio hub (linkpage/)
node scripts/dm-responder.js --simulate "PINK"   # preview the DM autoresponder
node scripts/dm-responder.js --export-manychat   # no-code IG DM automation flow
```

Every product post carries a UTM-tagged `tracked_link`; the Analyst ingests click exports (`output/clicks/latest.json`) and ranks products by click-through. See the **Sales funnel** section in `CLAUDE.md` for one-time setup (host the linkpage, GA4/Pixel, email form, ManyChat).

Full docs: `CLAUDE.md`. Weekly routine: `docs/review-workflow.md`.
