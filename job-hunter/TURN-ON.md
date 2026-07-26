# Turn Missy on — daily job-hunt digest

Missy is built and verified (10/10 offline tests pass). She's dormant because
(a) email isn't configured and (b) nothing runs her on a schedule. This is the
one-time setup to fix both. All local + private — nothing runs on GitHub.

## 1. Give Missy a permanent home

She currently only lives on the `claude/job-hunter-pipeline-kbzs75` branch inside
Website-Master. Check her out into her own stable folder with a git worktree
(keeps her isolated from the Trevo repo's `main`):

```
cd ~/Website-Master
git worktree add ~/missy claude/job-hunter-pipeline-kbzs75
cd ~/missy/job-hunter
npm install
```

Missy now lives at `~/missy/job-hunter`.

## 2. Configure it

```
cp .env.example .env
```
Then fill in `.env`. What's already handled vs. what you must add:
- `ANTHROPIC_API_KEY`, `ADZUNA_APP_ID/KEY`, the Google Sheet — already yours; copy
  the values you're using.
- **The one real gap → email:** set `ZOHO_SMTP_USER` + `ZOHO_SMTP_PASS`.
  - Zoho: your Zoho address + a Zoho app password.
  - Or Gmail instead: set `ZOHO_SMTP_HOST=smtp.gmail.com`, `ZOHO_SMTP_PORT=465`,
    `ZOHO_SMTP_USER=<your gmail>`, `ZOHO_SMTP_PASS=<a Gmail App Password>`.
  - Set `DIGEST_TO=` to the inbox you want the digest in.

## 3. Test before scheduling

```
npm run dry-run     # full pipeline, digest previews to terminal, sends nothing
npm run daily       # real run — should email you the digest once
```
Confirm a digest actually lands in your inbox before step 4.

## 4. Schedule the daily run (launchd)

```
mkdir -p ~/missy/job-hunter/logs
# edit deploy/com.dave.missy.daily.plist: replace <NODE_PATH> (run `which node`)
# and <MISSY_PATH> with /Users/davidhettinger/missy/job-hunter
cp deploy/com.dave.missy.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dave.missy.daily.plist
```
It now runs every morning at 6:00 AM (change Hour/Minute in the plist to taste)
and emails you a fresh, tailored digest of the best new matches. She never
applies to anything — the only outbound action is that email to you.

To stop it later: `launchctl unload ~/Library/LaunchAgents/com.dave.missy.daily.plist`.
