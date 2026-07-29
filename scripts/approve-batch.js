#!/usr/bin/env node
/**
 * Approve (or reject) a day's scraped lead batch before it can be emailed.
 *
 * The daily 6:30am pipeline scrapes a market and emails you the companies and
 * contacts it found. Nothing is sent until you approve that list here. The next
 * morning's run sends the approved batch, then scrapes the next market.
 *
 * Usage:
 *   node scripts/approve-batch.js                 # show pending batches
 *   node scripts/approve-batch.js --list          # same, explicit
 *   node scripts/approve-batch.js 2026-07-29      # approve that batch
 *   node scripts/approve-batch.js 2026-07-29 --reject
 *   node scripts/approve-batch.js --show 2026-07-29   # full contact list
 */

const {
  STATUS, loadStore, approveBatch, rejectBatch, getBatch, pendingBatches,
} = require('./lib/lead-batches');

function printBatch(b, { full = false } = {}) {
  console.log(`\n  ${b.date}  [${b.status}]  ${b.leads.length} contacts`);
  if (b.leads.length && b.leads[0].city) console.log(`  market: ${b.leads[0].trade} / ${b.leads[0].city}`);
  const rows = full ? b.leads : b.leads.slice(0, 10);
  rows.forEach(l => console.log(`    ${(l.business_name || '(no name)').padEnd(42)} ${l.email}`));
  if (!full && b.leads.length > rows.length) {
    console.log(`    … ${b.leads.length - rows.length} more — see --show ${b.date}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const reject = args.includes('--reject');
  const showIdx = args.indexOf('--show');
  const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

  if (showIdx !== -1) {
    const d = args[showIdx + 1] || dateArg;
    const b = getBatch(d);
    if (!b) { console.error(`No batch for ${d}.`); process.exit(1); }
    printBatch(b, { full: true });
    console.log('');
    return;
  }

  if (!dateArg || args.includes('--list')) {
    const pend = pendingBatches();
    const store = loadStore();
    const all = Object.values(store.batches).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
    if (!all.length) { console.log('No batches recorded yet. The daily pipeline creates them.'); return; }
    console.log('Recent batches:');
    all.forEach(b => printBatch(b));
    console.log('');
    if (pend.length) {
      console.log(`${pend.length} awaiting approval. To approve:`);
      pend.forEach(b => console.log(`  node scripts/approve-batch.js ${b.date}`));
    } else {
      console.log('Nothing awaiting approval.');
    }
    console.log('');
    return;
  }

  const before = getBatch(dateArg);
  if (!before) { console.error(`No batch for ${dateArg}. Run --list to see what exists.`); process.exit(1); }
  if (before.status === STATUS.SENT) {
    console.error(`Batch ${dateArg} was already sent on ${before.sentAt}. Nothing to do.`);
    process.exit(1);
  }

  const res = reject ? rejectBatch(dateArg) : approveBatch(dateArg);
  if (!res.ok) { console.error(`Could not update ${dateArg}: ${res.reason}`); process.exit(1); }

  console.log(`Batch ${dateArg} is now ${res.batch.status} (${res.batch.leads.length} contacts).`);
  if (!reject) {
    console.log('It will be sent by the next 6:30am run, or immediately with:');
    console.log(`  node scripts/pitcher.js --force --channel email --batch ${dateArg}`);
  }
}

if (require.main === module) main();
