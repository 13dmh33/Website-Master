'use strict';

// reel.js — turns a Generator "reel" post into an actual faceless vertical
// (1080x1920) .mp4 for Trevo Advisors (Molly). Two visual styles:
//
//   • card    — one text card per beat, Ken Burns motion, beat-synced cuts
//               (parseBeats + assembleReel).
//   • kinetic — word-by-word typography: one rendered state per word held for
//               its own duration, stitched via the concat demuxer
//               (buildKineticStates + assembleKineticReel). Sub-modes:
//               karaoke (progressive reveal, active word highlighted) and
//               punch (one big word at a time).
//
// No licensed music (brand rule) — reels ship silent with a null audio track so
// Buffer/Instagram accept them; Dave adds trending audio in-app.
//
// ffmpeg comes from @ffmpeg-installer/ffmpeg (a static binary bundled per
// platform), so this works the same in the container and on the Mac. The 2018
// build has no `xfade`, so transitions use `fade` + the `concat` filter.

const { execFile } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { tokenizeEmphasis } = require('./canvas-render');

// ── ffmpeg binary (bundled, cross-platform) ─────────────────────────────────
function ffmpegPath() {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.env.FFMPEG_PATH || 'ffmpeg'; // fall back to a PATH ffmpeg
  }
}

function ffmpegAvailable() {
  try {
    require('@ffmpeg-installer/ffmpeg');
    return true;
  } catch {
    return !!process.env.FFMPEG_PATH;
  }
}

// ── timing ──────────────────────────────────────────────────────────────────
const FPS         = 30;
const HOOK_SECS   = 3.0;  // first beat lingers — the hook has to land
const BEAT_SECS   = 2.4;  // base for every other beat (extended by read length)
const W           = 1080;
const H           = 1920;

// beat length scales with how much there is to read, so long lines don't flash
// by and short punchlines don't drag — the uneven pacing reads as edited.
function beatDuration(index, text) {
  const words = String(text || '').replace(/[*]/g, '').split(/\s+/).filter(Boolean).length;
  const base  = index === 0 ? HOOK_SECS : BEAT_SECS;
  const readBonus = Math.min(1.5, Math.max(0, (words - 4) * 0.22));
  return +(base + readBonus).toFixed(2);
}

// ── beat parsing ──────────────────────────────────────────────────────────────
// A beat = { text, voiceover }. `text` is the ON-SCREEN text that gets rendered
// into the frame; `voiceover` is kept for the review preview / shot list only.

// strip a leading "on-screen:" / "text:" style label from a fragment
function stripLabel(s) {
  return (s || '')
    .replace(/^\s*(?:on[-\s]?screen(?:\s*text)?|text|caption|osd)\s*[:\-]\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

// pull the voiceover out of a "voiceover: ..." / "vo: ..." fragment
function stripVoiceLabel(s) {
  return (s || '')
    .replace(/^\s*(?:voice[-\s]?over|voiceover|vo|audio|say|spoken)\s*[:\-]\s*/i, '')
    .trim();
}

// Parse a reel script (post.extra) into ordered beats.
// Tolerates the tightened format ("Beat 1: ON-SCREEN || voiceover") as well as
// looser numbered / "Scene N" / "Slide N" lists the model sometimes emits.
function parseScript(extra) {
  if (!extra || typeof extra !== 'string') return [];

  // split on beat/scene/shot/slide markers OR bare numbered list items
  const marker = /(?:^|\n)\s*(?:beat|scene|shot|slide)\s*\d+\s*[:.\-)]\s*/i;
  let chunks;
  if (marker.test(extra)) {
    chunks = extra.split(/(?:^|\n)\s*(?:beat|scene|shot|slide)\s*\d+\s*[:.\-)]\s*/i);
  } else {
    // fall back to "1. / 2)" numbered lines
    chunks = extra.split(/(?:^|\n)\s*\d+\s*[.)]\s+/);
  }

  const beats = [];
  for (const raw of chunks) {
    const chunk = (raw || '').trim();
    if (!chunk) continue;

    // on-screen text and voiceover may be separated by "||", " | ", " — ", or a newline
    let onscreen = chunk;
    let voice = '';
    const sep = chunk.match(/\s*(?:\|\||\s\|\s|\n)\s*/);
    if (sep) {
      onscreen = chunk.slice(0, sep.index);
      voice    = chunk.slice(sep.index + sep[0].length);
    }
    onscreen = stripLabel(onscreen);
    voice    = stripVoiceLabel(stripLabel(voice)).replace(/\s+/g, ' ').trim();
    // collapse any remaining internal newlines in the on-screen text
    onscreen = onscreen.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (onscreen) beats.push({ text: onscreen, voiceover: voice });
  }
  return beats;
}

// Synthesize beats from a post's core copy when there's no usable script
// (evergreen reels, or a script that parsed to nothing).
function synthesizeBeats(post) {
  const beats = [];
  if (post.hook) beats.push({ text: post.hook.trim(), voiceover: '' });

  const bodyLines = (post.body || '')
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  for (const line of bodyLines) beats.push({ text: line, voiceover: '' });

  if (post.cta) beats.push({ text: post.cta.trim(), voiceover: '' });

  // guarantee at least two beats so it reads as motion, not a still
  if (beats.length === 1 && post.caption) {
    const firstSentence = post.caption.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean)[1];
    if (firstSentence) beats.push({ text: firstSentence, voiceover: '' });
  }
  return beats;
}

// Public: resolve a post to 2–6 beats (parse script, else synthesize), capped.
function parseBeats(post) {
  let beats = parseScript(post && post.extra);
  if (beats.length < 2) beats = synthesizeBeats(post || {});
  // clamp to a sane reel length
  if (beats.length > 6) beats = beats.slice(0, 6);
  if (beats.length === 0 && post && post.hook) beats = [{ text: post.hook, voiceover: '' }];
  return beats;
}

// ── ffmpeg assembly ───────────────────────────────────────────────────────────

// Per-beat motion (Ken Burns). Varying direction beat-to-beat kills the robotic
// "same slow zoom every card" feel. Upscaling 2x before zoompan keeps it smooth
// (zoompan jitters on 1:1 sources). `on` = output frame index within the beat.
const CX = 'iw/2-(iw/zoom/2)';
const CY = 'ih/2-(ih/zoom/2)';
const zp = (z, x, y, frames) => `zoompan=z='${z}':d=${frames}:s=${W}x${H}:fps=${FPS}:x='${x}':y='${y}'`;
const MOTIONS = [
  (f) => zp(`1.0+0.10*on/${f}`,  CX, CY, f),                 // push in
  (f) => zp(`1.10-0.10*on/${f}`, CX, CY, f),                 // pull out
  (f) => zp('1.06', `(iw-iw/zoom)*on/${f}`,     CY, f),      // pan right
  (f) => zp('1.06', `(iw-iw/zoom)*(1-on/${f})`, CY, f),      // pan left
];

// Build the -filter_complex graph: per-beat varied motion, hard beat-synced cuts
// (fade only at the very open/close, no dip-to-black between beats), then a
// filmic grade + moving grain over the whole thing so it reads as shot/edited on
// a phone rather than a flat vector export. (This build has no `xfade`.)
function buildFilterGraph(durations) {
  const n = durations.length;
  const parts  = [];
  const labels = [];
  durations.forEach((dur, i) => {
    const frames = Math.max(1, Math.round(dur * FPS));
    let chain = `scale=${W * 2}:${H * 2},setsar=1,${MOTIONS[i % MOTIONS.length](frames)}`;
    if (i === 0)     chain += ',fade=t=in:st=0:d=0.35';                                  // open from black
    if (i === n - 1) chain += `,fade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4`; // close to black
    parts.push(`[${i}:v]${chain},format=yuv420p[v${i}]`);
    labels.push(`[v${i}]`);
  });
  // concat → gentle contrast/saturation lift → temporal (moving) film grain
  const grade = `concat=n=${n}:v=1:a=0,eq=contrast=1.05:saturation=1.06,noise=alls=10:allf=t+u,format=yuv420p[outv]`;
  return `${parts.join(';')};${labels.join('')}${grade}`;
}

// assembleReel — sequence rendered beat frames into a silent .mp4.
//   framePaths : ordered PNG paths (1080x1920 each), one per beat
//   outPath    : destination .mp4
// returns outPath on success; throws on ffmpeg error.
function assembleReel(framePaths, outPath, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(framePaths) || framePaths.length === 0) {
      return reject(new Error('assembleReel: no frames provided'));
    }
    if (!ffmpegAvailable()) {
      return reject(new Error('ffmpeg not available (install @ffmpeg-installer/ffmpeg or set FFMPEG_PATH)'));
    }

    const durations = (Array.isArray(opts.durations) && opts.durations.length === framePaths.length)
      ? opts.durations
      : framePaths.map((_, i) => beatDuration(i));
    const totalSecs = durations.reduce((a, b) => a + b, 0);

    const args = [];
    // One SINGLE-FRAME still input per beat. zoompan emits `d` frames per input
    // frame, so the beat's whole animation must come from exactly one frame —
    // feeding a looped multi-frame input (`-loop 1 -t dur`) made zoompan emit
    // d frames for EACH looped frame, ballooning beat 0 past the total runtime
    // so `-shortest` truncated the video to beat 0 (the later beats never
    // played). A bare `-i png` is one frame; zoompan's `d` sets the beat length.
    framePaths.forEach((p) => {
      args.push('-i', p);
    });
    // silent stereo audio track so Buffer/Instagram accept the file
    args.push('-f', 'lavfi', '-t', String(totalSecs.toFixed(2)), '-i', 'anullsrc=r=44100:cl=stereo');

    const audioIdx = framePaths.length; // index of the anullsrc input
    args.push(
      '-filter_complex', buildFilterGraph(durations),
      '-map', '[outv]',
      '-map', `${audioIdx}:a`,
      '-r', String(FPS),
      '-c:v', 'libx264',
      '-preset', opts.preset || 'medium',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-movflags', '+faststart',
      '-y', outPath,
    );

    execFile(ffmpegPath(), args, { maxBuffer: 1024 * 1024 * 32 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${(stderr || err.message).slice(-600)}`));
      resolve(outPath);
    });
  });
}

// ── kinetic (word-by-word) reels ──────────────────────────────────────────────

const WORD_SECS = 0.22; // base on-screen time per word (~260 wpm caption pace)
const END_HOLD  = 0.7;  // full line/last word held before the cut

function wordDuration(tok) {
  let d = WORD_SECS;
  if (String(tok.word || '').replace(/[^A-Za-z]/g, '').length > 7) d += 0.06; // long words linger
  if (tok.em) d += 0.14;                                                       // punch/emphasis words linger
  return +d.toFixed(3);
}

// Build the reveal-state list for one beat. Each state is one rendered frame:
//   karaoke → { revealCount, activeIndex, duration } accumulating words, then a
//             final full-line hold (activeIndex -1 → only *emphasis* stays lit).
//   punch   → one word per state; the last word absorbs the end hold.
function buildKineticStates(beatText, opts = {}) {
  const mode = opts.mode === 'punch' ? 'punch' : 'karaoke';
  const tokens = tokenizeEmphasis(beatText);
  if (!tokens.length) return [];

  const states = tokens.map((tok, k) => ({
    mode, revealCount: k + 1, activeIndex: k, duration: wordDuration(tok),
  }));

  if (mode === 'karaoke') {
    states.push({ mode, revealCount: tokens.length, activeIndex: -1, duration: END_HOLD, isHold: true });
  } else {
    states[states.length - 1].duration = +(states[states.length - 1].duration + END_HOLD).toFixed(3);
  }
  if (opts.isCtaBeat) states[states.length - 1].isCta = true;
  return states;
}

// the shared filmic finish (same grade + moving grain the card style uses)
function gradeChain() {
  return `eq=contrast=1.05:saturation=1.06,noise=alls=10:allf=t+u`;
}

// assembleKineticReel — hold each word-state PNG for its duration via the concat
// demuxer, add a gentle global drift + the filmic grade/grain, encode to .mp4.
//   framePaths / durations : parallel arrays, one entry per reveal-state
function assembleKineticReel(framePaths, durations, outPath, opts = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(framePaths) || !framePaths.length) return reject(new Error('assembleKineticReel: no frames'));
    if (!Array.isArray(durations) || durations.length !== framePaths.length) {
      return reject(new Error('assembleKineticReel: frames/durations length mismatch'));
    }
    if (!ffmpegAvailable()) return reject(new Error('ffmpeg not available'));

    const total       = durations.reduce((a, b) => a + b, 0);
    const totalFrames = Math.max(1, Math.round(total * FPS));

    // concat-demuxer list. The demuxer ignores the LAST entry's duration, so the
    // final file is listed once more to make its hold count.
    const esc = p => path.resolve(p).replace(/'/g, `'\\''`);
    let list = '';
    framePaths.forEach((p, i) => { list += `file '${esc(p)}'\nduration ${durations[i].toFixed(3)}\n`; });
    list += `file '${esc(framePaths[framePaths.length - 1])}'\n`;
    const listPath = path.join(os.tmpdir(), `kinetic-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(listPath, list);

    const graph =
      `[0:v]fps=${FPS},scale=${W * 2}:${H * 2},` +
      `zoompan=z='1.0+0.03*on/${totalFrames}':d=1:s=${W}x${H}:fps=${FPS},` +
      `${gradeChain()},fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, total - 0.4).toFixed(2)}:d=0.4,` +
      `format=yuv420p[outv]`;

    const args = [
      '-f', 'concat', '-safe', '0', '-i', listPath,
      '-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo',
      '-filter_complex', graph,
      '-map', '[outv]', '-map', '1:a',
      '-r', String(FPS),
      '-c:v', 'libx264', '-preset', opts.preset || 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', '-y', outPath,
    ];

    execFile(ffmpegPath(), args, { maxBuffer: 1024 * 1024 * 32 }, (err, _stdout, stderr) => {
      fs.unlink(listPath, () => {});
      if (err) return reject(new Error(`ffmpeg (kinetic) failed: ${(stderr || err.message).slice(-600)}`));
      resolve(outPath);
    });
  });
}

module.exports = {
  parseBeats,
  parseScript,
  synthesizeBeats,
  beatDuration,
  assembleReel,
  buildKineticStates,
  wordDuration,
  assembleKineticReel,
  ffmpegAvailable,
  ffmpegPath,
  FPS,
  W,
  H,
};
