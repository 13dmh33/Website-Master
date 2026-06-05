'use strict';

// market-audit — ranks US metros by contractor website demand
// reads config/market-data.json (static, zero API cost)
// usage: node scripts/market-audit.js [--trade hvac|plumbing|electrical|roofing|handyman] [--top N] [--csv]
// saves ranked report to reports/market-audit-{date}.json

const fs   = require('fs');
const path = require('path');

const DATA_PATH    = path.join(__dirname, '..', 'config', 'market-data.json');
const REPORTS_DIR  = path.join(__dirname, '..', 'reports');

function parseArgs() {
  const args  = process.argv.slice(2);
  const opts  = { trade: null, top: 20, csv: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trade' && args[i + 1]) opts.trade = args[++i].toLowerCase();
    if (args[i] === '--top'   && args[i + 1]) opts.top   = parseInt(args[++i], 10);
    if (args[i] === '--csv')                  opts.csv   = true;
  }
  return opts;
}

function loadMarkets() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error('config/market-data.json not found.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).markets;
}

function filterByTrade(markets, trade) {
  if (!trade) return markets;
  return markets.filter(m => m.trades.includes(trade));
}

function rankMarkets(markets) {
  return [...markets].sort((a, b) => b.demand_score - a.demand_score);
}

function printTable(ranked, opts) {
  const tradeLabel = opts.trade ? ` [${opts.trade.toUpperCase()}]` : ' [all trades]';
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  TREVO ADVISORS — Market Demand Audit${tradeLabel}`);
  console.log(`  Top ${opts.top} US metros ranked by contractor website opportunity`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  ${'#'.padEnd(4)} ${'City'.padEnd(22)} ${'State'.padEnd(8)} ${'Score'.padEnd(7)} ${'Gap'.padEnd(6)} ${'Density'.padEnd(9)} ${'Own%'.padEnd(6)} ${'Growth'}`);
  console.log(`${'─'.repeat(80)}`);

  ranked.slice(0, opts.top).forEach((m, i) => {
    const score  = m.demand_score.toFixed(2);
    const rank   = String(i + 1).padEnd(4);
    const city   = m.city.padEnd(22);
    const state  = m.state.padEnd(8);
    const gap    = String(m.digital_gap).padEnd(6);
    const dens   = String(m.contractor_density).padEnd(9);
    const own    = String(m.homeownership_rate).padEnd(6);
    const growth = String(m.growth_rate);
    console.log(`  ${rank} ${city} ${state} ${score.padEnd(7)} ${gap} ${dens} ${own} ${growth}`);
  });

  console.log(`${'─'.repeat(80)}`);
  console.log(`  Scores: Gap (0-10 weight 35%) · Density (30%) · Homeownership (20%) · Growth (15%)`);
  console.log();
}

function printTop5(ranked, trade) {
  const tradeLabel = trade ? trade.toUpperCase() : 'any trade';
  console.log(`\n  TOP 5 RECOMMENDED MARKETS for ${tradeLabel}:`);
  ranked.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.city}, ${m.state} (score: ${m.demand_score.toFixed(2)}) — ${m.notes}`);
  });
  console.log();
}

function saveCsv(ranked, opts) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const date     = new Date().toISOString().split('T')[0];
  const trade    = opts.trade || 'all';
  const csvPath  = path.join(REPORTS_DIR, `market-audit-${trade}-${date}.csv`);
  const header   = 'rank,city,state,demand_score,digital_gap,contractor_density,homeownership_rate,growth_rate,trades,notes';
  const rows     = ranked.map((m, i) =>
    `${i + 1},"${m.city}","${m.state}",${m.demand_score},${m.digital_gap},${m.contractor_density},${m.homeownership_rate},${m.growth_rate},"${m.trades.join('|')}","${m.notes.replace(/"/g, '""')}"`
  );
  fs.writeFileSync(csvPath, [header, ...rows].join('\n'));
  console.log(`  CSV saved to: ${csvPath}`);
}

function saveJson(ranked, opts) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const date     = new Date().toISOString().split('T')[0];
  const trade    = opts.trade || 'all';
  const jsonPath = path.join(REPORTS_DIR, `market-audit-${trade}-${date}.json`);
  const report   = {
    generatedAt: new Date().toISOString(),
    trade: opts.trade || 'all',
    totalMarkets: ranked.length,
    top5: ranked.slice(0, 5).map(m => ({ city: m.city, state: m.state, demand_score: m.demand_score, notes: m.notes })),
    ranked: ranked.map((m, i) => ({ rank: i + 1, ...m })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`  JSON saved to: ${jsonPath}`);
  return jsonPath;
}

function main() {
  const opts    = parseArgs();
  const markets = loadMarkets();
  const filtered = filterByTrade(markets, opts.trade);
  const ranked   = rankMarkets(filtered);

  printTable(ranked, opts);
  printTop5(ranked, opts.trade);

  if (opts.csv) saveCsv(ranked, opts);
  saveJson(ranked, opts);

  console.log(`  Run Scout on the top market:`);
  const top = ranked[0];
  const tradeArg = opts.trade || 'plumbing';
  console.log(`  node scripts/scout.js --city "${top.city}, ${top.state}" --trade ${tradeArg} --budget 0.25 --force`);
  console.log();
}

main();
