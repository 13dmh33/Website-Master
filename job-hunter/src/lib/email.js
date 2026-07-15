// email.js — sends the digest via Zoho SMTP (nodemailer).
//
// Review-only means email is the *only* outbound action, and it goes to Dave,
// never to any employer or job site. If SMTP is not configured the sender
// degrades to a no-op that reports `enabled: false`, and the orchestrator falls
// back to printing the digest to the terminal.

import nodemailer from 'nodemailer';
import { config, has } from './config.js';

let _transport = null;
function transport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: config.email.user, pass: config.email.pass },
  });
  return _transport;
}

export async function sendDigest({ subject, text, html }) {
  if (!has.email()) return { enabled: false };
  await transport().sendMail({
    from: `"${config.email.signature}" <${config.email.user}>`,
    to: config.email.to,
    subject,
    text,
    html,
  });
  return { enabled: true, to: config.email.to };
}
