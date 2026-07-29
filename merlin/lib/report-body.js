'use strict';
/**
 * The delivered body — report plus both paste-ready session prompts.
 *
 * Lives apart from lib/mailer.js so the GitHub-issue channel can render the
 * exact same content without pulling in nodemailer (and the SMTP stack it
 * implies) just to format a string. Both channels deliver to RECIPIENT: the
 * mailer directly, the issue channel via GitHub's notification email.
 */

const RECIPIENT = '13dmh33@gmail.com';

function buildEmailBody({ report, primaryPrompt, lightPrompt }) {
  return `${report}

---

## Primary session prompt (paste-ready)

\`\`\`
${primaryPrompt}
\`\`\`

---

## Light alternate session prompt (paste-ready)

\`\`\`
${lightPrompt}
\`\`\`
`;
}

module.exports = { buildEmailBody, RECIPIENT };
