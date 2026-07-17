/**
 * Draft-or-send dispatch — the single choke point every responder goes
 * through to deliver output. When the relevant gate (lib/gates.js) is off,
 * output is written as a draft/log entry instead of actually sent. A gate
 * being off must never throw or otherwise break the pipeline.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isLive } = require('./gates');

const NORA_ROOT = path.join(__dirname, '..');
const DRAFTS_DIR = path.join(NORA_ROOT, 'state', 'drafts');
const LOGS_DIR = path.join(NORA_ROOT, 'logs');

function log(line) {
  const ts = new Date().toISOString();
  const dateKey = ts.split('T')[0];
  const full = `[${ts}] ${line}`;
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, `${dateKey}.log`), full + '\n');
}

function writeDraft(customerId, channel, payload) {
  const dir = path.join(DRAFTS_DIR, customerId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `${ts}-${channel}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ channel, ...payload, created_at: new Date().toISOString() }, null, 2));
  return filePath;
}

/**
 * dispatchOutbound({ customerId, channel, payload, sendFn })
 *
 * If the channel's gate is live, calls sendFn(payload) (the real send —
 * e.g. a Twilio API POST) and returns its result. If the gate is off,
 * writes payload to a draft file and logs instead — sendFn is never called.
 *
 * Always returns { mode: 'live' | 'draft', ref, result? }.
 */
async function dispatchOutbound({ customerId, channel, payload, sendFn }) {
  if (isLive(channel)) {
    log(`LIVE send — customer=${customerId} channel=${channel}`);
    const result = await sendFn(payload);
    return { mode: 'live', ref: result && result.sid ? result.sid : null, result };
  }
  const draftPath = writeDraft(customerId, channel, payload);
  log(`DRAFT (gate off) — customer=${customerId} channel=${channel} -> ${draftPath}`);
  return { mode: 'draft', ref: draftPath };
}

module.exports = { dispatchOutbound, log, writeDraft, DRAFTS_DIR, LOGS_DIR };
