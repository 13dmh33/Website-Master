'use strict';
/**
 * Delivery — sends the report + both session prompts to 13dmh33@gmail.com
 * via Zoho SMTP. Matches pitcher.js's exact transport shape (already
 * proven working, real sends all session). SMTP is unaffected by the
 * standing IMAP-disabled blocker (different protocol) and reaches
 * external Gmail addresses by protocol design — see STATE-AUDIT.md.
 */

const nodemailer = require('nodemailer');

// Body rendering lives in report-body.js so the GitHub-issue channel can share
// it without requiring nodemailer. Re-exported here to keep this module's API.
const { buildEmailBody, RECIPIENT } = require('./report-body');

function getZohoTransport(zohoEmail, zohoAppPassword) {
  if (!zohoEmail || !zohoAppPassword) {
    throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local to send the Merlin report');
  }
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: zohoEmail, pass: zohoAppPassword },
  });
}

async function sendMerlinReport({ report, primaryPrompt, lightPrompt, date, zohoEmail, zohoAppPassword }) {
  const transport = getZohoTransport(zohoEmail, zohoAppPassword);
  const text = buildEmailBody({ report, primaryPrompt, lightPrompt });
  return transport.sendMail({
    from: zohoEmail,
    to: RECIPIENT,
    subject: `Merlin nightly report — ${date}`,
    text,
  });
}

module.exports = { sendMerlinReport, getZohoTransport, buildEmailBody, RECIPIENT };
