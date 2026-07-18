#!/usr/bin/env node
/**
 * Deliverability preflight — Tier 2.5. One-command gate to run before any
 * batch proposal send: SPF/DKIM/DMARC (via check-email-auth.js) plus a
 * live Zoho SMTP auth check that does NOT send a real message
 * (nodemailer's transport.verify() opens the connection and authenticates,
 * nothing more).
 *
 * Usage: node scripts/proposal-deliverability-preflight.js
 * Exit code 0 only if both checks pass.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const { spawnSync } = require('child_process');
const path = require('path');
const { getZohoSmtpTransport } = require('./lib/proposal/draft-mail');

function runEmailAuthCheck() {
  console.log('── Email authentication (SPF/DKIM/DMARC) ──');
  const result = spawnSync('node', [path.join(__dirname, 'check-email-auth.js')], { stdio: 'inherit' });
  return result.status === 0;
}

async function runSmtpAuthCheck() {
  console.log('\n── Zoho SMTP auth check (no message sent) ──');
  const zohoEmail = process.env.ZOHO_EMAIL;
  const zohoAppPassword = process.env.ZOHO_APP_PASSWORD;
  if (!zohoEmail || !zohoAppPassword) {
    console.error('ZOHO_EMAIL / ZOHO_APP_PASSWORD not set in .env.local.');
    return false;
  }
  try {
    const transport = getZohoSmtpTransport(zohoEmail, zohoAppPassword);
    await transport.verify();
    console.log('SMTP auth OK — connection and credentials verified, no message sent.');
    return true;
  } catch (err) {
    console.error(`SMTP auth failed: ${err.message}`);
    return false;
  }
}

async function main() {
  const emailAuthOk = runEmailAuthCheck();
  const smtpOk = await runSmtpAuthCheck();

  console.log('\n' + '─'.repeat(50));
  if (emailAuthOk && smtpOk) {
    console.log('Deliverability preflight: PASS. Safe to run a batch proposal send.');
    process.exit(0);
  } else {
    console.log('Deliverability preflight: FAIL. Do not batch-send until both checks pass.');
    process.exit(1);
  }
}

main();
