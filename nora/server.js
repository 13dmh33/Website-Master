#!/usr/bin/env node
/**
 * Nora webhook server — wires the missed-call and SMS Twilio webhooks to
 * core, one HTTP endpoint per customer per channel.
 *
 * Setup (one-time, per Mac dev/test — mirrors scripts/webhook.js):
 *   1. npm install ngrok -g   (or use the ngrok desktop app)
 *   2. node nora/server.js         (starts server on NORA_PORT, default 3100)
 *   3. ngrok http 3100             (exposes it; copy the https URL)
 *   4. Twilio console → Phone Numbers → your number →
 *      Voice → "A call comes in" is out of scope here (needs a TwiML app
 *      that dials out and falls back to a status callback) — this server
 *      only handles the *status callback* half (no-answer detection) and
 *      the inbound SMS webhook.
 *        - Voice status callback → https://xxxx.ngrok.io/nora/:customerId/missed-call
 *        - Messaging "A message comes in" → https://xxxx.ngrok.io/nora/:customerId/sms
 *
 * Routes:
 *   POST /nora/:customerId/missed-call  — Twilio voice status callback
 *   POST /nora/:customerId/sms          — Twilio inbound SMS webhook
 *
 * Environment variables (from .env.local, dev/test — single Nora-managed
 * number shared across customers until per-customer numbers are wired up):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_PHONE, NORA_PORT
 *
 * Safety: NORA_LIVE / SMS_LIVE gate every outbound send (lib/gates.js).
 * With both off (the default), inbound webhooks are still processed and
 * logged/drafted — nothing is lost — but no message ever reaches a real
 * customer until the gates are explicitly turned on.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const http = require('http');
const querystring = require('querystring');
const path = require('path');

const { validateTwilioSignature } = require('./lib/twilio');
const { log } = require('./lib/dispatch');
const { loadConfig } = require('./config/load-config');
const { processMessage } = require('./core');
const { notifyEscalation } = require('./lib/escalation-notifier');
const missedCallAdapter = require('./channels/missed_call/adapter');
const missedCallResponder = require('./channels/missed_call/responder');
const smsAdapter = require('./channels/sms/adapter');
const smsResponder = require('./channels/sms/responder');

const PORT = parseInt(process.env.NORA_PORT || '3100', 10);

function twilioCreds() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM_PHONE,
  };
}

function parsePath(url) {
  // /nora/:customerId/:route
  const parts = url.split('?')[0].split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'nora') return null;
  const [, customerId, route] = parts;
  if (route !== 'missed-call' && route !== 'sms') return null;
  return { customerId, route };
}

async function handleRoute({ customerId, route }, params) {
  const config = loadConfig(customerId);

  const message = route === 'missed-call'
    ? missedCallAdapter.twilioCallbackToNormalizedMessage(customerId, params)
    : smsAdapter.twilioSmsToNormalizedMessage(customerId, params);

  if (!message) {
    log(`customer=${customerId} route=${route} — not an actionable event (CallStatus=${params.CallStatus || 'n/a'}), no action taken`);
    return;
  }

  const { decision } = processMessage(message, config);
  log(`customer=${customerId} route=${route} from=${message.fromIdentity} action=${decision.action}`);

  const responder = route === 'missed-call' ? missedCallResponder : smsResponder;
  const dispatchResult = await responder.respond({
    config, decision, toIdentity: message.fromIdentity, twilioCreds: twilioCreds(),
  });
  log(`customer=${customerId} route=${route} reply dispatch mode=${dispatchResult.mode}`);

  if (decision.action === 'escalate') {
    await notifyEscalation({ config, message, triggers: decision.triggers, twilioCreds: twilioCreds() });
  }
}

const server = http.createServer((req, res) => {
  const parsed = parsePath(req.url);

  if (req.method !== 'POST' || !parsed) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk.toString(); });

  req.on('end', async () => {
    const params = querystring.parse(rawBody);
    const signature = req.headers['x-twilio-signature'] || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers['host'] || `localhost:${PORT}`;
    const fullUrl = `${protocol}://${host}${req.url}`;

    if (!validateTwilioSignature(authToken, signature, fullUrl, params)) {
      log(`WARN: invalid Twilio signature from ${req.socket.remoteAddress} on ${req.url} — rejected`);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      await handleRoute(parsed, params);
    } catch (err) {
      log(`ERROR handling ${req.url}: ${err.message}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('');
    console.log('-'.repeat(50));
    console.log('  Nora webhook server');
    console.log('-'.repeat(50));
    console.log(`  Listening on port ${PORT}`);
    console.log('  Routes:');
    console.log('    POST /nora/:customerId/missed-call');
    console.log('    POST /nora/:customerId/sms');
    console.log('');
    console.log(`  NORA_LIVE=${process.env.NORA_LIVE === 'true' ? 'on' : 'off'}  SMS_LIVE=${process.env.SMS_LIVE === 'true' ? 'on' : 'off'}`);
    console.log(`  Logs: ${path.join(__dirname, 'logs')}`);
    console.log('-'.repeat(50));
    console.log('');
  });

  server.on('error', (err) => {
    console.error(`Server error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — set NORA_PORT to a different value.`);
    }
    process.exit(1);
  });
}

module.exports = { server, parsePath, handleRoute };
