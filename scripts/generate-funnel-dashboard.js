#!/usr/bin/env node
/**
 * Generates the funnel + Apollo hit-rate dashboard as a static page.
 * Read-only: reads state.json, leads/*.json, leads-web/*.json,
 * config/pitcher-config.json. Writes only website/dashboard/funnel.html
 * and website/dashboard/funnel-data.json — no pipeline file is touched.
 *
 * Usage: node scripts/generate-funnel-dashboard.js
 */

const fs = require('fs');
const path = require('path');

const { computeFunnel, FUNNEL_ORDER } = require('./lib/funnel');
const { computeApolloMetrics } = require('./lib/apollo-metrics');
const { loadPhoneOnlyLeads, loadHasWebsiteLeads, LEADS_WEB_DIR } = require('./lib/lead-files');

const ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'state.json');
const PITCHER_CONFIG_PATH = path.join(ROOT, 'config', 'pitcher-config.json');
const OUT_DIR = path.join(ROOT, 'website', 'dashboard');

const STAGE_LABELS = {
  scouted: 'Scouted',
  diagnosed: 'Diagnosed',
  checked: 'Checked (approved)',
  sent: 'Sent',
  drip_d1_sent: 'Drip — day 4',
  drip_d1b_sent: 'Drip — day 8',
  drip_d1c_sent: 'Drip — day 12',
  drip_d2_sent: 'Drip — day 19',
  replied: 'Replied',
  hot: 'Booking reply sent',
};

function readJsonSafe(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function buildData() {
  const state = readJsonSafe(STATE_PATH, { queue: [] });
  const funnel = computeFunnel(state.queue);

  const phoneOnlyApollo = computeApolloMetrics(loadPhoneOnlyLeads());
  const hasWebsiteApollo = computeApolloMetrics(loadHasWebsiteLeads());

  const pitcherConfig = readJsonSafe(PITCHER_CONFIG_PATH, {});
  const leadsWebTrackedInGit = fs.existsSync(path.join(ROOT, '.git'))
    ? require('child_process').execSync('git ls-files leads-web/ | wc -l', { cwd: ROOT }).toString().trim() !== '0'
    : null;

  return {
    generatedAt: new Date().toISOString(),
    funnel,
    apollo: { phoneOnly: phoneOnlyApollo, hasWebsite: hasWebsiteApollo },
    context: {
      pitcherDailyLimit: pitcherConfig.daily_limit ?? null,
      leadsWebTrackedInGit,
    },
  };
}

function pct(n) { return n === null || n === undefined ? 'n/a' : `${n}%`; }
function usd(n) { return n === null || n === undefined ? 'n/a' : `$${n.toFixed(4)}`; }

function funnelBarsHtml(data) {
  const max = Math.max(1, ...FUNNEL_ORDER.map(s => data.funnel.cumulativeReached[s]));
  return FUNNEL_ORDER.map(stage => {
    const count = data.funnel.cumulativeReached[stage];
    const widthPct = Math.round((count / max) * 100);
    return `
      <div class="funnel-row">
        <div class="funnel-label">${STAGE_LABELS[stage]}</div>
        <div class="funnel-bar-track">
          <div class="funnel-bar" style="width:${widthPct}%"></div>
        </div>
        <div class="funnel-count">${count}</div>
      </div>`;
  }).join('\n');
}

function transitionsTableHtml(data) {
  const rows = data.funnel.transitions
    .filter(t => t.countFrom > 0)
    .map(t => `
      <tr>
        <td>${STAGE_LABELS[t.from]} &rarr; ${STAGE_LABELS[t.to]}</td>
        <td>${t.countFrom}</td>
        <td>${t.countTo}</td>
        <td>${t.lost}</td>
        <td>${pct(t.conversionPct)}</td>
      </tr>`).join('\n');
  return `
    <table>
      <thead><tr><th>Transition</th><th>Reached start</th><th>Reached end</th><th>Lost</th><th>Conversion</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function apolloPanelHtml(label, m) {
  return `
    <div class="apollo-card">
      <h3>${label}</h3>
      <dl>
        <dt>Attempted</dt><dd>${m.attempted}</dd>
        <dt>Hits</dt><dd>${m.hits}</dd>
        <dt>Hit rate</dt><dd>${pct(m.hitRatePct)}</dd>
        <dt>Cost per successful email</dt><dd>${usd(m.costPerHitUsd)}</dd>
      </dl>
    </div>`;
}

function renderHtml(data) {
  const dropoff = data.funnel.biggestDropoff;
  const dropoffCaveat = dropoff && dropoff.from === 'checked' && dropoff.to === 'sent' && data.context.pitcherDailyLimit
    ? `This is very likely a send-capacity limit, not a quality problem — Pitcher sends at most ${data.context.pitcherDailyLimit} per day, and ${dropoff.countFrom} leads are already approved and waiting.`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trevo Advisors — funnel dashboard</title>
<style>
  :root {
    --navy: #0A1228; --teal: #00C8AF; --deep-teal: #008870;
    --white: #FFFFFF; --muted: #8BA8C4; --border: rgba(255,255,255,0.08);
  }
  * { box-sizing: border-box; }
  body {
    background: var(--navy); color: var(--white);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    margin: 0; padding: 2.5rem 1.5rem 4rem; line-height: 1.5;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 2rem; }
  h2 { font-size: 1.1rem; margin: 2.5rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  .callout {
    background: rgba(0,200,175,0.08); border: 1px solid var(--teal);
    border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem;
  }
  .callout .headline { font-weight: 600; color: var(--teal); margin-bottom: 0.35rem; }
  .callout .note { color: var(--muted); font-size: 0.9rem; }
  .funnel-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .funnel-label { width: 170px; flex-shrink: 0; font-size: 0.9rem; color: var(--muted); }
  .funnel-bar-track { flex: 1; background: var(--border); border-radius: 4px; height: 22px; overflow: hidden; }
  .funnel-bar { background: linear-gradient(90deg, var(--deep-teal), var(--teal)); height: 100%; min-width: 2px; }
  .funnel-count { width: 50px; text-align: right; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
  .apollo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
  .apollo-card { border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; }
  .apollo-card h3 { margin: 0 0 0.75rem; font-size: 0.95rem; }
  dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 0.35rem 0.75rem; }
  dt { color: var(--muted); font-size: 0.85rem; }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .caveats { color: var(--muted); font-size: 0.85rem; }
  .caveats li { margin-bottom: 0.5rem; }
  .side-stat { color: var(--muted); font-size: 0.85rem; margin-top: 0.5rem; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Funnel + Apollo hit-rate dashboard</h1>
    <div class="meta">Generated ${data.generatedAt}</div>

    <div class="callout">
      <div class="headline">Biggest drop-off: ${dropoff ? `${STAGE_LABELS[dropoff.from]} &rarr; ${STAGE_LABELS[dropoff.to]} — ${dropoff.lost} leads lost (${pct(dropoff.conversionPct)} conversion)` : 'not enough data yet'}</div>
      ${dropoffCaveat ? `<div class="note">${dropoffCaveat}</div>` : ''}
    </div>

    <h2>Funnel</h2>
    ${funnelBarsHtml(data)}
    <div class="side-stat">${data.funnel.mockupInProduction} lead(s) currently in mockup production (Builder/Filmer — not a required funnel gate, most leads skip it)</div>

    <h2>Conversion by stage</h2>
    ${transitionsTableHtml(data)}

    <h2>Apollo hit rate</h2>
    <div class="apollo-grid">
      ${apolloPanelHtml('Phone-only leads (headline)', data.apollo.phoneOnly)}
      ${apolloPanelHtml('Has-website leads', data.apollo.hasWebsite)}
    </div>

    <h2>What this dashboard cannot measure yet</h2>
    <ul class="caveats">
      <li><strong>Opened:</strong> ${data.funnel.unmeasured.opened}</li>
      <li><strong>Booked:</strong> ${data.funnel.unmeasured.booked}</li>
      <li><strong>Closed:</strong> ${data.funnel.unmeasured.closedMeansWon} (${data.funnel.closedCount} currently closed, all data-quality rejections as of this build).</li>
      ${data.context.leadsWebTrackedInGit === false ? '<li><strong>Has-website Apollo figures:</strong> leads-web/ is not currently tracked in git, so the scheduled daily refresh (which runs from a fresh checkout) only sees the phone-only breakdown reliably — has-website numbers may read zero in the automated run even when real local data exists.</li>' : ''}
      <li>Apollo and funnel instrumentation measure forward from deploy — no historical backfill.</li>
    </ul>
  </div>
</body>
</html>`;
}

function main() {
  const data = buildData();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'funnel-data.json'), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'funnel.html'), renderHtml(data));
  console.log(`Wrote ${path.join(OUT_DIR, 'funnel.html')}`);
  console.log(`Wrote ${path.join(OUT_DIR, 'funnel-data.json')}`);
}

main();
