'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

const reel   = require('../lib/reel');
const render = require('../lib/canvas-render');

// ── beat parsing ──────────────────────────────────────────────────────────────
// lib/reel.js is brand-agnostic (ported unchanged from Miley) — these tests
// confirm it still behaves the same way against Molly's post shape.

test('parseBeats reads the tightened "Beat N: on-screen || voiceover" script', () => {
  const post = {
    format: 'reel',
    extra: 'Beat 1: We just updated our demo site || push in on laptop\n'
         + 'Beat 2: Tap-to-call, reviews live || phone screen\n'
         + 'Beat 3: DM us the word demo || logo end card',
  };
  const beats = reel.parseBeats(post);
  assert.equal(beats.length, 3);
  assert.equal(beats[0].text, 'We just updated our demo site');
  assert.equal(beats[0].voiceover, 'push in on laptop');
  assert.equal(beats[2].text, 'DM us the word demo');
});

test('parseBeats tolerates loose numbered / Scene / Slide lists', () => {
  const numbered = reel.parseBeats({ extra: '1. First line\n2) Second line\n3. Third line' });
  assert.equal(numbered.length, 3);
  assert.equal(numbered[1].text, 'Second line');

  const scenes = reel.parseBeats({ extra: 'Scene 1: Alpha\nScene 2: Beta' });
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].text, 'Alpha');
});

test('parseBeats synthesizes beats from hook/body/cta when there is no script', () => {
  // this is the shape agents/generator.js actually produces for Molly's reel
  // post (see generateReelScript / evergreen prewrittenContent) — no `extra`.
  const beats = reel.parseBeats({
    format: 'reel',
    hook: 'Same contractor. Same trade. One thing changed.',
    body: 'He was running on referrals — solid, with a ceiling.',
    cta:  'DM us the word demo. — Trevo',
  });
  assert.equal(beats.length, 3);
  assert.equal(beats[0].text, 'Same contractor. Same trade. One thing changed.');
  assert.equal(beats[beats.length - 1].text, 'DM us the word demo. — Trevo');
});

test('parseBeats clamps to at most 6 beats', () => {
  const extra = Array.from({ length: 10 }, (_, i) => `Beat ${i + 1}: line ${i + 1}`).join('\n');
  assert.equal(reel.parseBeats({ extra }).length, 6);
});

// ── frame rendering (Molly's canvas-render.js reel-frame additions) ──────────

test('renderReelFrame produces a valid 1080x1920 PNG buffer', async () => {
  const buf = await render.renderReelFrame({
    text: 'We just updated our demo site', beatNum: 1, total: 3, niche: 'reel', isCta: false,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  assert.equal(buf.slice(0, 4).toString('hex'), '89504e47'); // PNG magic bytes
});

test('renderReelFrame auto-fits very long on-screen text without throwing', async () => {
  const long = 'This is an unusually long on screen line that must wrap across several rows and still render';
  const buf = await render.renderReelFrame({ text: long, beatNum: 2, total: 3, niche: 'reel', isCta: false });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});

test('renderReelFrame renders *emphasis* markers without throwing', async () => {
  const buf = await render.renderReelFrame({ text: 'Same trade. *One* thing changed.', beatNum: 1, total: 3, niche: 'reel', isCta: false });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
});

test('beatDuration lingers on longer lines and gives the hook extra time', () => {
  const shortBeat = reel.beatDuration(1, 'DM us the word demo.');
  const longBeat  = reel.beatDuration(1, 'He was running on referrals — solid, but with a ceiling, until this changed');
  assert.ok(longBeat > shortBeat, 'longer line should read longer');
  assert.ok(reel.beatDuration(0, 'x') >= reel.beatDuration(1, 'x'), 'hook >= normal beat');
});

// ── kinetic (word-by-word) states ─────────────────────────────────────────────

test('buildKineticStates (karaoke) reveals one word per state plus a final hold', () => {
  const states = reel.buildKineticStates('Same trade. *One* thing changed.', { mode: 'karaoke' });
  // 5 words → 5 reveal states + 1 hold
  assert.equal(states.length, 6);
  assert.deepEqual(states.slice(0, 5).map(s => s.revealCount), [1, 2, 3, 4, 5]);
  assert.equal(states[5].isHold, true);
  assert.equal(states[5].activeIndex, -1);
  // the emphasized word lingers longer than a plain word
  const emphasisIdx = states.findIndex((s, i) => i < 5 && s.duration > states[0].duration);
  assert.ok(emphasisIdx > 0, 'an emphasized word should linger longer than the first word');
});

test('buildKineticStates (punch) is one word per state and folds the hold into the last', () => {
  const s = reel.buildKineticStates('DM us the word demo now', { mode: 'punch', isCtaBeat: true });
  assert.equal(s.length, 6); // 6 words, no separate hold state in punch mode
  assert.deepEqual(s.map(x => x.activeIndex), [0, 1, 2, 3, 4, 5]);
  assert.equal(s[s.length - 1].isCta, true);
  assert.ok(s[s.length - 1].duration > s[0].duration, 'last punch word absorbs the end hold');
});

test('renderReelWordFrame renders both karaoke and punch states', async () => {
  const kara = await render.renderReelWordFrame({ text: 'Same trade. *One* thing changed.', revealCount: 2, activeIndex: 1, mode: 'karaoke', beatNum: 1, total: 3, niche: 'reel' });
  assert.equal(kara.slice(0, 4).toString('hex'), '89504e47');
  const punch = await render.renderReelWordFrame({ text: 'Same trade. *One* thing changed.', activeIndex: 1, mode: 'punch', beatNum: 1, total: 3, niche: 'reel', isCta: true });
  assert.ok(Buffer.isBuffer(punch) && punch.length > 0);
});

// ── mp4 assembly (uses the bundled static ffmpeg) ─────────────────────────────

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
      const buf = await render.renderReelFrame({ text: `Beat ${i + 1}`, beatNum: i + 1, total: 2, niche: 'reel', isCta: i === 1 });
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

// Regression: every beat must actually play. A looped multi-frame input made
// zoompan over-emit frames for beat 0, so `-shortest` truncated the whole reel
// to beat 0 and the later beats never appeared (see lib/reel.js assembleReel's
// comment). Prove the LAST beat is on screen during its own time window by
// using solid-color frames and sampling the video late.
test('assembleReel plays through all beats (last beat visible at the end)', async (t) => {
  if (!reel.ffmpegAvailable()) return t.skip('ffmpeg not available');
  const { execFile } = require('child_process');
  const { Canvas, loadImage } = require('skia-canvas');

  const solid = async (hex) => {
    const c = new Canvas(reel.W, reel.H);
    const g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, reel.W, reel.H);
    return c.toBuffer('png');
  };
  const sampleMeanRGB = async (pngPath) => {
    const img = await loadImage(pngPath);
    const c = new Canvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, img.width, img.height);
    let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 997) { r += data[i]; gr += data[i + 1]; b += data[i + 2]; n++; }
    return { r: r / n, g: gr / n, b: b / n };
  };
  const extractFrame = (video, atSecs, dest) => new Promise((res, rej) => {
    execFile(reel.ffmpegPath(), ['-ss', String(atSecs), '-i', video, '-frames:v', '1', '-y', dest],
      (err) => err ? rej(err) : res(dest));
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-beats-'));
  try {
    // beat 0 red, beat 1 green, beat 2 blue — 1s each
    const colors = ['#FF0000', '#00FF00', '#0000FF'];
    const frames = [];
    for (let i = 0; i < colors.length; i++) {
      const p = path.join(dir, `b${i}.png`);
      fs.writeFileSync(p, await solid(colors[i]));
      frames.push(p);
    }
    const out = path.join(dir, 'reel.mp4');
    await reel.assembleReel(frames, out, { durations: [1, 1, 1] });

    // sample mid-way through the LAST beat (total 3s → ~2.5s): must read blue.
    const late = await extractFrame(out, 2.5, path.join(dir, 'late.png'));
    const { r, g, b } = await sampleMeanRGB(late);
    assert.ok(b > r + 40 && b > g + 40, `expected blue (beat 3) late in reel, got rgb(${r|0},${g|0},${b|0})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
