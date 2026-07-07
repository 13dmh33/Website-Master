'use strict';

// publish-reels-review.js — builds the phone-openable reels review page at
// website/review/tatas-reels/index.html (served by Netlify).
//
// This is the hook/tone GATE — the single most important control in the lane.
// For each reel it shows all 3 hooks (radio), the full script, the shot list,
// and the caption, plus an Approve/Reject choice. Because the site is static
// (no backend), the page computes a compact DECISIONS STRING you copy and paste
// into the `tatas-reels-build` workflow's `decisions` input on your phone;
// approve-reels.js applies it. Default selection is hook 1 + Approve, so a
// straight "approve everything" is one copy.
//
// A separate page from the carousel /review/tatas/ (Phase 1's publish-cards.js
// owns that file and must not be modified) — this lives at /review/tatas-reels/.
//
// usage:
//   node scripts/publish-reels-review.js               # latest week in reels[]
//   node scripts/publish-reels-review.js --week 2026-07-13

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const reelsState = require('../lib/reels-state');

const REPO_ROOT   = path.join(__dirname, '..', '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reelCard(reel) {
  const hooks = reel.hooks.map((h, i) => `
      <label class="hook">
        <input type="radio" name="hook-${reel.id}" value="${i + 1}" ${i === 0 ? 'checked' : ''}
               onchange="update()" />
        <span>${esc(h)}</span>
      </label>`).join('');

  const shots = reel.shotList.map((s, i) => `<li><b>${i + 1}.</b> ${esc(s)}</li>`).join('');

  return `
    <div class="reel" data-id="${esc(reel.id)}">
      <h2>${reel.slot} · ${esc(reel.topic)} <span class="src">${reel.source}</span>
          <span class="st st-${reel.status}">${reel.status}</span></h2>

      <div class="block"><span class="lbl">Pick a hook</span>${hooks}</div>

      <div class="block"><span class="lbl">Script (voiceover)</span>
        <p class="script">${esc(reel.script)}</p></div>

      <div class="block"><span class="lbl">Shot list (on-screen text)</span>
        <ol class="shots">${shots}</ol></div>

      <div class="block"><span class="lbl">Caption</span>
        <pre class="cap">${esc(reel.caption)}\n\n${esc(reel.hashtags.join(' '))}</pre></div>

      <div class="block decision"><span class="lbl">Decision</span>
        <label><input type="radio" name="dec-${reel.id}" value="approve" checked onchange="update()" /> Approve</label>
        <label><input type="radio" name="dec-${reel.id}" value="reject" onchange="update()" /> Reject</label>
      </div>
    </div>`;
}

function buildPage(reels, weekOf) {
  const cards = reels.map(reelCard).join('\n');
  const ids   = JSON.stringify(reels.map(r => r.id));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tech 4 Tatas Reels — week of ${weekOf}</title>
<style>
  body { font-family: system-ui, sans-serif; background:#1A1A1D; color:#F7F4F0; padding:1.25rem; max-width:760px; margin:0 auto; }
  h1 { color:#FF2E88; margin-bottom:.2rem; }
  p.sub { color:#FFB3D1; margin-top:0; font-size:.9rem; }
  .reel { background:#232327; border:1px solid #333; border-radius:14px; padding:1.25rem; margin-bottom:1.5rem; }
  .reel h2 { color:#FF2E88; font-size:1rem; margin:0 0 .75rem; }
  .src { color:#FFC400; font-size:.75rem; }
  .st { font-size:.7rem; padding:.1rem .4rem; border-radius:6px; background:#333; color:#ccc; }
  .st-approved { background:#1f5130; color:#9be29b; } .st-rejected { background:#5a2020; color:#ffb3b3; }
  .st-voiced { background:#204a5a; color:#a7d8ff; }
  .block { margin:.85rem 0; }
  .lbl { display:block; color:#FFC400; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; margin-bottom:.4rem; }
  label.hook { display:flex; gap:.5rem; align-items:flex-start; padding:.4rem 0; cursor:pointer; }
  label.hook span { line-height:1.4; }
  .script { line-height:1.6; background:#1A1A1D; padding:.85rem; border-radius:8px; margin:0; }
  .shots { margin:0; padding-left:1.2rem; line-height:1.7; }
  pre.cap { white-space:pre-wrap; font-family:inherit; background:#1A1A1D; padding:.85rem; border-radius:8px; margin:0; font-size:.92rem; line-height:1.5; }
  .decision label { margin-right:1.25rem; }
  .out { position:sticky; bottom:0; background:#101013; border:1px solid #FF2E88; border-radius:12px; padding:1rem; margin-top:1rem; }
  .out textarea { width:100%; box-sizing:border-box; height:70px; background:#1A1A1D; color:#F7F4F0; border:1px solid #444; border-radius:8px; font-family:monospace; font-size:.8rem; padding:.5rem; }
  .out button { margin-top:.5rem; background:#FF2E88; color:#fff; border:none; border-radius:8px; padding:.6rem 1rem; font-size:.9rem; cursor:pointer; }
  .out p { font-size:.78rem; color:#8a8a90; margin:.5rem 0 0; }
</style></head><body>
  <h1>Tech 4 Tatas — Reels review</h1>
  <p class="sub">Week of ${weekOf} · ${reels.length} reels · pick a hook + Approve/Reject, then copy the decisions string into the <b>tatas-reels-build</b> workflow.</p>
  ${cards}

  <div class="out">
    <span class="lbl">Decisions string — paste into tatas-reels-build → "decisions"</span>
    <textarea id="decisions" readonly></textarea>
    <button onclick="copyDecisions()">Copy decisions</button>
    <p>Format: <code>id:hook#</code> to approve with that hook, <code>id:reject</code> to reject. Defaults to hook 1 + approve for every reel.</p>
  </div>

<script>
  var IDS = ${ids};
  function update() {
    var parts = IDS.map(function (id) {
      var dec = document.querySelector('input[name="dec-' + id + '"]:checked').value;
      if (dec === 'reject') return id + ':reject';
      var hook = document.querySelector('input[name="hook-' + id + '"]:checked').value;
      return id + ':' + hook;
    });
    document.getElementById('decisions').value = parts.join(';');
  }
  function copyDecisions() {
    var ta = document.getElementById('decisions');
    ta.select();
    navigator.clipboard && navigator.clipboard.writeText(ta.value);
  }
  update();
</script>
</body></html>`;
}

function main() {
  const current = reelsState.load();
  const weekOf  = argValue('--week') || reelsState.latestWeek(current);
  if (!weekOf) {
    console.log('reels[] is empty — run writer-reels.js first.');
    process.exit(0);
  }

  const reels = current.reels.filter(r => r.weekOf === weekOf);
  const reviewDir = path.join(WEBSITE_DIR, 'review', 'tatas-reels');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, 'index.html'), buildPage(reels, weekOf), 'utf8');

  console.log(`Reels review page published → website/review/tatas-reels/index.html (${reels.length} reels, week ${weekOf})`);
}

main();
