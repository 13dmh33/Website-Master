'use strict';

// Regression guard for the reel video-drop bug: the approval step
// (scripts/push-queue.js) must forward a queue record's rendered reel .mp4
// (record.video) to the Buffer poster as videoPath, or an approved reel posts
// as its static cover image instead of the video.

const test   = require('node:test');
const assert = require('node:assert/strict');

const { buildSchedulePayload } = require('../scripts/push-queue');

test('a queue record with a reel video forwards it to the poster payload (the bug)', () => {
  const record = {
    slot: 'THU', contentType: 'motivational', format: 'reel',
    images: ['out/1-THU-reel-frame-01.png'],
    video:  'out/images/2099-01-05/1-THU-reel.mp4',
    postText: 'caption + tags', scheduledFor: '2099-01-07T02:00:00Z',
  };
  const payload = buildSchedulePayload(record);
  // the regression assertion: the .mp4 must reach the poster, not be dropped
  assert.equal(payload.videoPath, 'out/images/2099-01-05/1-THU-reel.mp4');
  // cover frame still forwarded (becomes the reel thumbnail), caption + time intact
  assert.deepEqual(payload.imagePaths, ['out/1-THU-reel-frame-01.png']);
  assert.equal(payload.caption, 'caption + tags');
  assert.equal(payload.scheduledAt, '2099-01-07T02:00:00Z');
});

test('an image/carousel record (no video) is unchanged — no videoPath forwarded', () => {
  const record = {
    slot: 'TUE', contentType: 'engagement', format: 'carousel',
    images: ['out/1-TUE-slide-01.png', 'out/1-TUE-slide-02.png'],
    postText: 'caption', scheduledFor: '2099-01-05T19:00:00Z',
  };
  const payload = buildSchedulePayload(record);
  assert.ok(!payload.videoPath, 'no video → videoPath stays falsy, image path unchanged');
  assert.deepEqual(payload.imagePaths, ['out/1-TUE-slide-01.png', 'out/1-TUE-slide-02.png']);
  assert.equal(payload.caption, 'caption');
});

test('caption falls back to record.caption when postText is absent', () => {
  const payload = buildSchedulePayload({ images: [], caption: 'fallback', scheduledFor: 'x' });
  assert.equal(payload.caption, 'fallback');
});
