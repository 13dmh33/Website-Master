'use strict';
/**
 * Proposal delivery — draft-to-Zoho-Drafts by default, real SMTP send only
 * when PROPOSAL_SEND_LIVE is on. Mirrors the gate-off-writes-a-draft
 * pattern used throughout this repo's other agents (Nora's
 * lib/dispatch.js, this repo's own drafts-only defaults elsewhere).
 *
 * scripts/reply-agent.js (branch claude/email-agent-scope-audit-ku4pkc,
 * not present on this branch — see STATE-AUDIT.md) already writes to Zoho
 * Drafts via imapflow with a hand-rolled MIME builder. This reimplements
 * the same IMAP-append-to-Drafts behavior but builds the MIME message with
 * nodemailer's MailComposer (an existing repo dependency) instead of
 * hand-rolling header/MIME encoding — fewer places to get boundary/
 * encoding edge cases wrong.
 *
 * Live-verified this session: writeToZohoDrafts() currently fails against
 * the real account with `authenticationFailed: true,
 * responseText: "You are yet to enable IMAP for your account..."` — the
 * exact same pre-existing blocker already documented for
 * scripts/reply-agent.js (IMAP is not enabled in Zoho Mail admin settings
 * for dave@trevoadvisors.com). This is an account-settings toggle, not a
 * bug here — the code is correct and ready the moment IMAP is enabled.
 * sendViaZohoSmtp() is unaffected (different protocol/port, and matches
 * pitcher.js's already-proven-working SMTP transport exactly), which is
 * why the safer default (drafts) is currently the one that can't be
 * live-verified, not the live-send path — reinforcing PROPOSAL_SEND_LIVE
 * should stay off until IMAP is enabled and drafts can actually be reviewed.
 */

const nodemailer = require('nodemailer');
// nodemailer v6 exposes MailComposer as a submodule, not a named export off the package.
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');

/** Builds a raw MIME message buffer. No network access. */
function buildMime({ from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    new MailComposer({ from, to, subject, html }).compile().build((err, message) => {
      if (err) reject(err); else resolve(message);
    });
  });
}

/** Appends a MIME message to the account's Drafts folder. Throws loud on any IMAP failure. */
async function writeToZohoDrafts({ mime, zohoEmail, zohoAppPassword }) {
  if (!zohoEmail || !zohoAppPassword) {
    throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local to write a proposal draft');
  }
  const client = new ImapFlow({
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    auth: { user: zohoEmail, pass: zohoAppPassword },
    logger: false,
  });

  await client.connect();
  try {
    const mailbox = await client.getMailboxLock('Drafts').catch(() => null);
    if (mailbox) mailbox.release();
    const result = await client.append('Drafts', mime, ['\\Draft']);
    return result;
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function getZohoSmtpTransport(zohoEmail, zohoAppPassword) {
  if (!zohoEmail || !zohoAppPassword) {
    throw new Error('ZOHO_EMAIL and ZOHO_APP_PASSWORD must be set in .env.local to send a proposal');
  }
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: zohoEmail, pass: zohoAppPassword },
  });
}

/** Sends for real via Zoho SMTP. Only ever called when PROPOSAL_SEND_LIVE is on. */
async function sendViaZohoSmtp({ from, to, subject, html, zohoEmail, zohoAppPassword }) {
  const transport = getZohoSmtpTransport(zohoEmail, zohoAppPassword);
  return transport.sendMail({ from, to, subject, html });
}

/**
 * deliverProposal({ from, to, subject, html, zohoEmail, zohoAppPassword, live })
 * live=false (default): builds the MIME and writes it to Zoho Drafts for review.
 * live=true: sends for real via SMTP.
 * Always returns { mode: 'draft' | 'live', ... }.
 */
async function deliverProposal({ from, to, subject, html, zohoEmail, zohoAppPassword, live }) {
  if (live) {
    const result = await sendViaZohoSmtp({ from, to, subject, html, zohoEmail, zohoAppPassword });
    return { mode: 'live', messageId: result.messageId };
  }
  const mime = await buildMime({ from, to, subject, html });
  await writeToZohoDrafts({ mime, zohoEmail, zohoAppPassword });
  return { mode: 'draft' };
}

module.exports = { buildMime, writeToZohoDrafts, sendViaZohoSmtp, deliverProposal, getZohoSmtpTransport };
