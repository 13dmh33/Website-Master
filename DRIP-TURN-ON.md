# Turn drip on — daily follow-up sequence

Merlin flags **169 leads sitting at `sent` with no follow-up** — they got one
email and nothing since, because `drip.js` has never run on a schedule. Turning
it on is the biggest no-new-code lever in the pipeline right now.

Drip is **built, gated, and verified** — this is a "verify then enable," not a
build.

## What's already safe (verified 2026-07-26)
- **CAN-SPAM:** every drip email gets the compliance footer (ad ID + your postal
  address + reply-"stop") via `appendFooter`; `assertEmailCompliant()` blocks the
  send if anything's missing.
- **Suppression:** contact-keyed do-not-contact is enforced on every drip lead
  (email/phone/domain) — opt-outs can't be re-contacted, even across re-scrapes.
- **Reply exit:** leads that replied / opted out / converted (`reply_drafted`,
  `unsubscribed`, `positive`) are skipped.
- **Copy:** the email d1/d1b/d1c/d2 bodies are timing-agnostic ("following up on
  my last note"), so following up on an 8–21-day-old send doesn't read as stale.
  (Cap: 20/day, `config/drip-config.json`.)

## One thing to know about the 169 backlog
None of them are recent — 118 are 8–21 days old, 49 are 21+ days. That's fine for
**email** (the copy doesn't claim a timeframe). Email is also the only channel
that can send — **SMS drip stays off until Twilio A2P clears**, which is why the
launchd job is `--channel email` only.

## Steps

1. **Preview first — this shows exactly who gets what, sends nothing:**
   ```
   cd ~/Website-Master
   node scripts/drip.js --dry-run --force --channel email
   ```
   Read it: confirm the recipients look right and each is getting a sensible
   next step (most of the 169 will get d1).

2. **Send one real batch by hand** and confirm it looks right in your Sent inbox:
   ```
   node scripts/drip.js --force --channel email
   ```
   (Sends up to 20, staggered, each with the compliance footer.)

3. **Schedule it** (daily 9am, after the morning pitcher):
   ```
   mkdir -p ~/Website-Master/logs
   # edit deploy/com.trevo.drip.daily.plist: set __NODE_PATH__ (`which node`)
   # and __REPO_PATH__ = /Users/davidhettinger/Website-Master
   cp deploy/com.trevo.drip.daily.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.trevo.drip.daily.plist
   ```
   To stop later: `launchctl unload ~/Library/LaunchAgents/com.trevo.drip.daily.plist`.

Once running, the 169 backlog clears at 20/day and every future send gets its
follow-up sequence automatically — the leak Merlin's been flagging closes.
