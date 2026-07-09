# CHECKPOINT — fix-reel-video-drop

**Status: DONE.** No resume needed. (No `CONTINUE.md` written.)

> Note: the repo already has an unrelated tracked `CHECKPOINT.md` (the Sheet-Log
> CRM checkpoint), so this task's checkpoint is filed here to avoid clobbering it.

## The bug
`miley/scripts/push-queue.js` (the approval step that releases the reviewed week
to Buffer) called `buffer.schedulePost({ imagePaths, caption, scheduledAt })` —
it never forwarded the reel's rendered `.mp4`. The video path is present in the
queue record as `record.video` (written by the scheduler), but it was dropped at
the handoff, so an approved reel would post as its **static cover image**, not
the video.

## What changed (scoped to the posting handoff only)
- **`miley/scripts/push-queue.js`**
  - Added `buildSchedulePayload(record)` — a pure, exported function that builds
    the exact object passed to `buffer.schedulePost`, now including
    `videoPath: record.video || null`. Reads the field that already exists on the
    record; the queue record shape is unchanged.
  - `main()` now uses `buildSchedulePayload(post)`; the image/carousel path is
    identical to before when there is no video (`videoPath` is `null`).
  - Guarded the CLI entrypoint with `if (require.main === module)` and added
    `module.exports = { buildSchedulePayload }`, so the handoff is unit-testable
    without touching the queue, Buffer, or a token. Running
    `node scripts/push-queue.js` behaves exactly as before.
- **`miley/lib/buffer.js`** — no change needed. `schedulePost` already accepts
  `videoPath`, uploads the video, sets `media[video]` (with the cover frame as
  `media[thumbnail]`), and falls back to the image on failure. Confirmed, and now
  actually reached.
- **`miley/test/push-queue.test.js`** (new) — regression guard:
  - a record with `video` → payload `videoPath` equals that path (the bug);
  - an image/carousel record (no video) → no `videoPath`, image path unchanged;
  - caption falls back to `record.caption` when `postText` is absent.

Nothing in the Miley content/generation pipeline or reel render code was touched.

## How to verify
```bash
cd miley
node --test test/*.test.js            # 32 pass, 0 fail (29 existing + 3 new)
node --test test/push-queue.test.js   # 3 pass
node scripts/push-queue.js --dry-run  # reel rows now print “· reel video: 1 (.mp4)” and “as VIDEO”
```
Regression proof: running `test/push-queue.test.js` against the pre-fix
`push-queue.js` (`git show origin/main:miley/scripts/push-queue.js`) **fails
(0/1)**; against the fix it **passes (3/3)**.

## One remaining manual step (Mac, live)
1. Add a Buffer **classic** token to `miley/.env`:
   `BUFFER_ACCESS_TOKEN=…` (and `BUFFER_INSTAGRAM_PROFILE_ID=…`).
2. Push **one** reel through as a live smoke test and confirm it lands on
   Instagram **as a video Reel, not a cover image**:
   ```bash
   cd miley
   node scripts/push-queue.js --dry-run   # confirm the reel row shows “as VIDEO”
   node scripts/push-queue.js             # schedules to Buffer at the slot time
   ```
   Then check the Buffer queue / the posted Reel.

Note: Buffer's free-tier Instagram **Reel video** support via the v1 API is not
independently verified here — this live smoke test is what confirms the
end-to-end video post. Everything up to the Buffer API call is fixed and tested.
