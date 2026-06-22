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

Full docs: `CLAUDE.md`. Weekly routine: `docs/review-workflow.md`.
