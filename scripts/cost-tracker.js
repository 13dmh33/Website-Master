/**
 * cost-tracker — append-only cost log shared across all agents
 *
 * Writes to config/cost-log.json (tracked in git).
 * Works from both container (Diagnoser/Checker) and Mac (Scout/Pitcher).
 */

const fs   = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'config', 'cost-log.json');

const TWILIO_PER_SMS_USD = 0.0079;

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return { events: [] };
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { events: [] }; }
}

function saveLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function append(service, script, costUsd, meta = {}) {
  const log = loadLog();
  log.events.push({
    ts:       new Date().toISOString(),
    service,
    script,
    cost_usd: parseFloat(costUsd.toFixed(6)),
    meta
  });
  saveLog(log);
}

function recordAnthropic(costUsd, script, usage = {}) {
  append('anthropic', script, costUsd, {
    input_tokens:  usage.input_tokens                   || 0,
    output_tokens: usage.output_tokens                  || 0,
    cache_read:    usage.cache_read_input_tokens         || 0,
    cache_write:   usage.cache_creation_input_tokens    || 0
  });
}

function recordTwilio(messageCount, script = 'pitcher') {
  if (messageCount <= 0) return;
  append('twilio', script, messageCount * TWILIO_PER_SMS_USD, { messages: messageCount });
}

function recordEmail(messageCount, script = 'pitcher') {
  if (messageCount <= 0) return;
  // Zoho is a flat subscription — $0 per send, track volume only
  append('email', script, 0, { messages: messageCount });
}

function recordOutscraper(leadCount, costPerLead, script = 'scout') {
  if (leadCount <= 0) return;
  append('outscraper', script, leadCount * costPerLead, { leads: leadCount });
}

function dateStr(ts)  { return ts.split('T')[0]; }
function monthStr(ts) { return ts.substring(0, 7); }

function aggregate(events) {
  const out = {};
  for (const e of events) {
    if (!out[e.service]) out[e.service] = { cost_usd: 0 };
    out[e.service].cost_usd += e.cost_usd;
    for (const [k, v] of Object.entries(e.meta || {})) {
      if (typeof v === 'number') {
        out[e.service][k] = (out[e.service][k] || 0) + v;
      }
    }
  }
  for (const svc of Object.values(out)) {
    svc.cost_usd = parseFloat(svc.cost_usd.toFixed(6));
  }
  return out;
}

function getDailySummary(date)   { return aggregate(loadLog().events.filter(e => dateStr(e.ts)  === date)); }
function getMonthlySummary(month){ return aggregate(loadLog().events.filter(e => monthStr(e.ts) === month)); }
function getAllTimeSummary()      { return aggregate(loadLog().events); }

module.exports = {
  recordAnthropic,
  recordTwilio,
  recordEmail,
  recordOutscraper,
  getDailySummary,
  getMonthlySummary,
  getAllTimeSummary,
  TWILIO_PER_SMS_USD
};
