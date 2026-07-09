'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

const reel    = require('../lib/reel');
const render  = require('../lib/canvas-render');
const planner = require('../lib/planner');

// ── beat parsing ──────────────────────────────────────────────────────────────

test('parseBeats reads the tightened "Beat N: on-screen || voiceover" script', () => {
  const post = {
    format: 'reel',
    extra: 'Beat 1: She earned that toolbag || push on a wrench\n'
         + 'Beat 2: Every callout. Every doubt. || jobsite cuts\n'
         + 'Beat 3: Tag a tradeswoman || logo end card',
  };
  const beats = reel.parseBeats(post);
  assert.equal(beats.length, 3);
  assert.equal(beats[0].text, 'She earned that toolbag');
  assert.equal(beats[0].voiceover, 'push on a wrench');
  assert.equal(beats[2].text, 'Tag a tradeswoman');
});

test('parseBeats tolerates loose numbered / Scene / Slide lists', () => {
  const numbered = reel.parseBeats({ extra: '1. First line\n2) Second line\n3. Third line' });
  assert.equal(numbered.length, 3);
  assert.equal(numbered[1].text, 'Second line');

  const scenes = reel.parseBeats({ extra: 'Scene 1: Alpha\nScene 2: Beta' });
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].text, 'Alpha');
});

test('parseBeats strips ON-SCREEN labels and surrounding quotes', () => {
  const beats = reel.parseBeats({ extra: 'Beat 1: ON-SCREEN: "Built for the jobsite" || vo\nBeat 2: text: Second' });
  assert.equal(beats[0].text, 'Built for the jobsite');
  assert.equal(beats[1].text, 'Second');
});

test('parseBeats synthesizes beats from hook/body/cta when there is no script', () => {
  const beats = reel.parseBeats({
    format: 'reel',
    hook: 'Nobody handed her the toolbag.',
    body: 'Every callout she answered.\nEvery doubt she outworked.',
    cta: 'Tag a tradeswoman.',
  });
  assert.ok(beats.length >= 3);
  assert.equal(beats[0].text, 'Nobody handed her the toolbag.');
  assert.equal(beats[beats.length - 1].text, 'Tag a tradeswoman.');
});

test('parseBeats clamps to at most 6 beats', () => {
  const extra = Array.from({ length: 10 }, (_, i) => `Beat ${i + 1}: line ${i + 1}`).join('\n');
  assert.equal(reel.parseBeats({ extra }).length, 6);
});

// ── frame rendering ───────────────────────────────────────────────────────────

test('renderReelFrame produces a valid 1080x1920 PNG buffer', async () => {
  const buf = await render.renderReelFrame({
    text: 'She earned that toolbag', beatNum: 1, total: 4, paletteKey: 'mission', isCta: false,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  // PNG magic bytes
  assert.equal(buf.slice(0, 4).toString('hex'), '89504e47');
});

test('renderReelFrame auto-fits very long on-screen text without throwing', async () => {
  const long = 'This is an unusually long on screen line that must wrap across several rows and still render';
  const buf = await render.renderReelFrame({ text: long, beatNum: 2, total: 3, paletteKey: 'awareness', isCta: false });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});

test('renderReelFrame renders *emphasis* markers without throwing', async () => {
  const buf = await render.renderReelFrame({ text: 'She *earned* that toolbag', beatNum: 1, total: 4, paletteKey: 'mission', isCta: false });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});

test('beatDuration lingers on longer lines and gives the hook extra time', () => {
  const shortBeat = reel.beatDuration(1, 'Not luck. Reps.');
  const longBeat  = reel.beatDuration(1, 'Every callout she answered and every doubt she outworked on the job');
  assert.ok(longBeat > shortBeat, 'longer line should read longer');
  assert.ok(reel.beatDuration(0, 'x') >= reel.beatDuration(1, 'x'), 'hook >= normal beat');
});

// ── mp4 assembly (uses the bundled static ffmpeg) ─────────────────────────────

// ── kinetic (word-by-word) states ─────────────────────────────────────────────

test('buildKineticStates (karaoke) reveals one word per state plus a final hold', () => {
  const states = reel.buildKineticStates('She *earned* that toolbag', { mode: 'karaoke' });
  // 4 words → 4 reveal states + 1 hold
  assert.equal(states.length, 5);
  assert.deepEqual(states.slice(0, 4).map(s => s.revealCount), [1, 2, 3, 4]);
  assert.deepEqual(states.slice(0, 4).map(s => s.activeIndex), [0, 1, 2, 3]);
  assert.equal(states[4].isHold, true);
  assert.equal(states[4].activeIndex, -1);
  // the emphasized word (index 1) lingers longer than a plain word
  assert.ok(states[1].duration > states[0].duration);
});

test('buildKineticStates (punch) is one word per state and folds the hold into the last', () => {
  const s = reel.buildKineticStates('Tag a tradeswoman who *earned* it', { mode: 'punch', isCtaBeat: true });
  assert.equal(s.length, 6); // 6 words, no separate hold state in punch mode
  assert.deepEqual(s.map(x => x.activeIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(s[s.length - 1].isCta, true);
  assert.ok(s[s.length - 1].duration > s[0].duration, 'last punch word absorbs the end hold');
});

test('renderReelWordFrame renders both karaoke and punch states', async () => {
  const kara = await render.renderReelWordFrame({ text: 'She *earned* that toolbag', revealCount: 2, activeIndex: 1, mode: 'karaoke', beatNum: 1, total: 3, paletteKey: 'mission' });
  assert.equal(kara.slice(0, 4).toString('hex'), '89504e47');
  const punch = await render.renderReelWordFrame({ text: 'She *earned* that toolbag', activeIndex: 1, mode: 'punch', beatNum: 1, total: 3, paletteKey: 'mission', isCta: true });
  assert.ok(Buffer.isBuffer(punch) && punch.length > 0);
});

test('planner rotates reel_style weekly across the configured styles', () => {
  const styleFor = (wk) => {
    const plan = planner.buildWeekPlan(new Date('2026-07-13'), wk);
    const reelPost = plan.posts.find(p => p.format === 'reel');
    return reelPost ? reelPost.reel_style : null;
  };
  // reels land on even weeks here; the style advances week % 3 through the list
  assert.equal(styleFor(0), 'card');
  assert.equal(styleFor(2), 'kinetic_punch');
  assert.equal(styleFor(4), 'kinetic_karaoke');
  // non-reel formats never carry a reel_style
  const plan = planner.buildWeekPlan(new Date('2026-07-13'), 0);
  assert.ok(plan.posts.filter(p => p.format !== 'reel').every(p => p.reel_style === null));
});

test('assembleKineticReel holds states for exact durations and yields an .mp4', async (t) => {
  if (!reel.ffmpegAvailable()) return t.skip('ffmpeg not available');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kin-test-'));
  try {
    const frames = [], durations = [];
    for (let i = 0; i < 3; i++) {
      const buf = await render.renderReelWordFrame({ text: 'One two three', revealCount: i + 1, activeIndex: i, mode: 'karaoke', beatNum: 1, total: 1 });
      const p = path.join(dir, `s${i}.png`);
      fs.writeFileSync(p, buf); frames.push(p); durations.push(0.3);
    }
    const out = path.join(dir, 'k.mp4');
    await reel.assembleKineticReel(frames, durations, out);
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000);
    assert.equal(fs.readFileSync(out).slice(4, 8).toString('ascii'), 'ftyp');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('assembleReel stitches frames into a non-empty .mp4', async (t) => {
  if (!reel.ffmpegAvailable()) return t.skip('ffmpeg not available');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-test-'));
  try {
    const frames = [];
    for (let i = 0; i < 2; i++) {
      const buf = await render.renderReelFrame({ text: `Beat ${i + 1}`, beatNum: i + 1, total: 2, paletteKey: 'mission', isCta: i === 1 });
      const p = path.join(dir, `f${i}.png`);
      fs.writeFileSync(p, buf);
      frames.push(p);
    }
    const out = path.join(dir, 'reel.mp4');
    await reel.assembleReel(frames, out);
    assert.ok(fs.existsSync(out));
    assert.ok(fs.statSync(out).size > 1000);
    // mp4 ftyp box at bytes 4-8
    assert.equal(fs.readFileSync(out).slice(4, 8).toString('ascii'), 'ftyp');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
