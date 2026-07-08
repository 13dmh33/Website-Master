'use strict';

// reel.js — turns a Generator "reel" post into an actual faceless vertical
// (1080x1920) .mp4 for Techs4Tatas (Miley).
//
// Two jobs:
//   1. parseBeats(post)      — read the reel script (post.extra) into beats, or
//                              synthesize beats from hook/body/cta when there's
//                              no script (evergreen reels carry no `extra`).
//   2. assembleReel(...)     — sequence the rendered beat frames into a silent
//                              H.264 reel via the bundled static ffmpeg, with a
//                              slow push-in (zoompan) + soft fades between beats.
//
// No licensed music (brand rule) — the reel ships silent with a null audio
// track so Buffer/Instagram accept it; Dave adds trending audio in-app.
//
// ffmpeg comes from @ffmpeg-installer/ffmpeg (a static binary bundled per
// platform), so this works the same in the container and on the Mac. The 2018
// build has no `xfade`, so transitions use `fade` + the `concat` filter.

const { execFile } = require('child_process');

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
const BEAT_SECS   = 2.6;  // every other beat
const FADE_SECS   = 0.4;  // soft entrance on each beat (no xfade in this build)
const W           = 1080;
const H           = 1920;

function beatDuration(index) {
  return index === 0 ? HOOK_SECS : BEAT_SECS;
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

// Build the -filter_complex graph: per-frame slow push-in (zoompan) + soft fade
// entrance, then concat all beats into one stream. Upscaling 2x before zoompan
// keeps the push-in smooth (zoompan jitters on 1:1 sources).
function buildFilterGraph(durations) {
  const parts = [];
  const labels = [];
  durations.forEach((dur, i) => {
    const frames = Math.max(1, Math.round(dur * FPS));
    // gentle push-in from 1.0 → ~1.08 over the beat, centered
    const zoom = `zoompan=z='min(zoom+0.0009,1.08)':d=${frames}:s=${W}x${H}:fps=${FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    const fade = `fade=t=in:st=0:d=${FADE_SECS}`;
    parts.push(`[${i}:v]scale=${W * 2}:${H * 2},setsar=1,${zoom},${fade},format=yuv420p[v${i}]`);
    labels.push(`[v${i}]`);
  });
  const concat = `${labels.join('')}concat=n=${durations.length}:v=1:a=0[outv]`;
  return `${parts.join(';')};${concat}`;
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

    const durations = framePaths.map((_, i) => beatDuration(i));
    const totalSecs = durations.reduce((a, b) => a + b, 0);

    const args = [];
    // one looped-still input per beat
    framePaths.forEach((p, i) => {
      args.push('-loop', '1', '-t', String(durations[i]), '-i', p);
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

module.exports = {
  parseBeats,
  parseScript,
  synthesizeBeats,
  assembleReel,
  ffmpegAvailable,
  ffmpegPath,
  FPS,
  W,
  H,
};
