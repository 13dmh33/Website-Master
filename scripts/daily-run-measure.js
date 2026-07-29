#!/usr/bin/env node
/**
 * Measures one daily-lead-gen run and records the day's batch.
 *
 * Split out of daily-lead-gen.sh deliberately: this was a ~40-line inline
 * `node -e` blob inside the shell script, which is unreadable, untestable, and
 * a quoting hazard. As a real module it can be unit-tested and reasoned about.
 *
 * Two jobs:
 *   1. Count what each stage actually produced, by inspecting files on disk
 *      rather than trusting exit codes — a stage can exit 0 having done nothing,
 *      which is precisely the silent failure the daily report exists to catch.
 *   2. Record today's email-ready leads as a PENDING batch. Pending sends
 *      nothing; tomorrow's run only sends it if Dave approved it in between.
 *
 * Usage (called by daily-lead-gen.sh):
 *   node scripts/daily-run-measure.js <out.json> <date> <city> <trade> \
 *        <rotDone> <rotLeft> <scoutRc> <sheetRc> <sentCount>
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { rotationStatus } = require('./lib/market-rotation');
const { createBatch } = require('./lib/lead-batches');

/** Approved, email-channel, real address, still unsent, and actually checked. */
function collectEmailReadyLeads(root = ROOT) {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const checked = new Set(state.queue.filter(l => l.status === 'checked').map(l => l.lead_id));
  const queueDir = path.join(root, 'queue');
  const leads = [];
  let briefs = 0, approved = 0;

  for (const f of fs.readdirSync(queueDir).filter(x => x.endsWith('-brief.json'))) {
    let b;
    try { b = JSON.parse(fs.readFileSync(path.join(queueDir, f), 'utf8')); } catch { continue; }
    briefs++;
    if (!b.checker_approved) continue;
    approved++;

    const id = f.replace('-brief.json', '');
    if (b.channel !== 'email' || !(b.email || '').trim() || !checked.has(id)) continue;

    const sentPath = path.join(root, 'messages', `${id}-sent.json`);
    if (fs.existsSync(sentPath)) {
      try { if (JSON.parse(fs.readFileSync(sentPath, 'utf8')).email_sent) continue; } catch { /* treat unreadable as unsent */ }
    }
    leads.push({
      lead_id: id, business_name: b.business_name, email: b.email,
      city: b.city, trade: b.trade,
    });
  }
  return { leads, briefs, approved };
}

/** New leads + harvested emails, counted from files this run actually wrote. */
function countTodaysScrape(date, root = ROOT) {
  let newLeads = 0, emailsFound = 0;
  for (const dir of ['leads', 'leads-web']) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (!f.includes(date) || !f.endsWith('.json')) continue;
      let d;
      try { d = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8')); } catch { continue; }
      const arr = Array.isArray(d) ? d : (d.leads || []);
      newLeads += arr.length;
      emailsFound += arr.filter(l => (l.email || '').trim()).length;
    }
  }
  return { newLeads, emailsFound };
}

function main() {
  const [out, date, city, trade, rotDone, rotLeft, scoutRc, sheetRc, sentCount] = process.argv.slice(2);

  const { leads, briefs, approved } = collectEmailReadyLeads();
  const { newLeads, emailsFound } = countTodaysScrape(date);
  const scoutCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'scout-config.json'), 'utf8'));
  const rot = rotationStatus();

  const made = createBatch(date, leads);

  const results = {
    date, city, trade,
    stages: {
      scout:     { newLeads, exitCode: Number(scoutRc) },
      scrape:    { emailsFound },
      diagnoser: { briefs },
      checker:   { approved },
      sheetLog:  { rows: Number(sheetRc) === 0 ? approved : null, exitCode: Number(sheetRc) },
    },
    readyToSend: leads.length,
    sentToday: Number(sentCount || 0),
    batch: { date, status: made.batch.status, count: made.batch.leads.length, created: made.created },
    batchLeads: made.batch.leads,
    spend: scoutCfg.spent_this_month,
    rotation: { done: rot.done, remaining: rot.remaining, reportedDone: Number(rotDone), reportedLeft: Number(rotLeft) },
  };

  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(
    `New leads: ${newLeads} | emails: ${emailsFound} | approved: ${approved} | ` +
    `batch ${date}: ${made.batch.leads.length} pending approval | sent earlier: ${results.sentToday}`
  );
}

module.exports = { collectEmailReadyLeads, countTodaysScrape };

if (require.main === module) main();
