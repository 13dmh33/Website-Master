# Quarantine

`evergreen-prespec.json` (moved here 2026-07-18, formerly `templates/evergreen.json`)
is Molly's original content library, written before `molly/CLAUDE.md`'s brand-voice
spec existed. It violates most of that spec — unsourced statistics, hard delivery-time
promises stated as headlines, client-result posts with no indication of real consent,
and city references under what is now a national-only targeting rule. Full list in
`molly/CLAUDE.md`'s "Known conflicts" section.

**Not deleted — drafting raw material.** The underlying angles (the invisible-loss
thesis, the "what happens when a customer can't find you" framing) are reusable; the
specific unsourced numbers, promised timelines, and fabricated-reading results are not.

**Never read by the live pipeline.** `lib/store.js`'s `PATHS.evergreen` still points
here so nothing crashes if old code paths call `getEvergreen()`/`getUnusedEvergreen()`,
but `lib/brand-validator.js` is now a hard gate on the posting path
(`scripts/push-queue.js`) — any post sourced from this file will fail validation on
the unsourced-statistic and delivery-promise checks alone and will not reach Buffer.

To un-quarantine a specific post: hand-rewrite it against `molly/CLAUDE.md`'s content
pillars and sourcing rules, move the rewritten version into the live content flow, and
confirm it passes `node -e "require('./lib/brand-validator').validatePost(post)"`
before it's queued.
