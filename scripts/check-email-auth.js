// check-email-auth.js
// Verifies SPF, DKIM, and DMARC DNS records for a domain.
// Zero dependencies. Node 18+ (ESM).
//
// Usage:
//   node check-email-auth.js
//   node check-email-auth.js trevoadvisors.com
//   node check-email-auth.js trevoadvisors.com zmail        (custom DKIM selector)
//
// Or set defaults via env:
//   DOMAIN=trevoadvisors.com DKIM_SELECTOR=zmail node check-email-auth.js
//
// Exit code is 0 only if SPF, DKIM, and DMARC all pass.

import { resolveTxt } from 'node:dns/promises';

const DOMAIN = process.argv[2] || process.env.DOMAIN || 'trevoadvisors.com';
const DKIM_SELECTOR = process.argv[3] || process.env.DKIM_SELECTOR || 'zoho';

// ANSI colors (no emojis, per brand standard).
const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const tag = {
  pass: `${c.green}[PASS]${c.reset}`,
  fail: `${c.red}[FAIL]${c.reset}`,
  warn: `${c.yellow}[WARN]${c.reset}`,
};

// Look up a TXT record and flatten each record's chunks into one string.
async function lookup(host) {
  try {
    const records = await resolveTxt(host);
    return records.map((chunks) => chunks.join(''));
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
    throw err;
  }
}

function line(status, label, detail) {
  console.log(`${status} ${c.bold}${label}${c.reset}`);
  if (detail) console.log(`       ${c.dim}${detail}${c.reset}`);
}

async function checkSPF() {
  const records = await lookup(DOMAIN);
  const spf = records.filter((r) => r.toLowerCase().startsWith('v=spf1'));

  if (spf.length === 0) {
    line(tag.fail, 'SPF', 'No v=spf1 record found at the root domain.');
    return false;
  }
  if (spf.length > 1) {
    line(tag.fail, 'SPF', `Found ${spf.length} SPF records. A domain must have exactly one.`);
    spf.forEach((r) => console.log(`       ${c.dim}${r}${c.reset}`));
    return false;
  }
  const record = spf[0];
  const hasZoho = /include:zoho(mail)?\.(com|eu|in)/i.test(record);
  const hasReject = /-all\s*$/.test(record);
  const hasSoftFail = /~all\s*$/.test(record);

  if (!hasZoho) {
    line(tag.warn, 'SPF', `Record exists but does not include Zoho. Value: ${record}`);
    return false;
  }
  if (!hasReject && !hasSoftFail) {
    line(tag.warn, 'SPF', `Zoho included, but no ~all or -all qualifier. Value: ${record}`);
    return true;
  }
  line(tag.pass, 'SPF', record);
  return true;
}

async function checkDKIM() {
  const host = `${DKIM_SELECTOR}._domainkey.${DOMAIN}`;
  const records = await lookup(host);
  const dkim = records.find((r) => /v=dkim1/i.test(r) || /p=/i.test(r));

  if (!dkim) {
    line(tag.fail, `DKIM (selector: ${DKIM_SELECTOR})`,
      `No record at ${host}. Generate DKIM in Zoho Admin, then confirm the selector name matches.`);
    return false;
  }
  const keyMatch = dkim.match(/p=([A-Za-z0-9+/=]+)/);
  if (!keyMatch || keyMatch[1].length < 20) {
    line(tag.warn, `DKIM (selector: ${DKIM_SELECTOR})`,
      `Record found but public key looks empty or revoked. Value: ${dkim}`);
    return false;
  }
  line(tag.pass, `DKIM (selector: ${DKIM_SELECTOR})`,
    `Key found at ${host} (${keyMatch[1].length} chars).`);
  return true;
}

async function checkDMARC() {
  const host = `_dmarc.${DOMAIN}`;
  const records = await lookup(host);
  const dmarc = records.find((r) => r.toLowerCase().startsWith('v=dmarc1'));

  if (!dmarc) {
    line(tag.fail, 'DMARC', `No v=DMARC1 record found at ${host}.`);
    return false;
  }
  const policy = (dmarc.match(/p=(none|quarantine|reject)/i) || [])[1]?.toLowerCase();
  const hasRua = /rua=mailto:/i.test(dmarc);

  if (!policy) {
    line(tag.warn, 'DMARC', `Record exists but no valid p= policy. Value: ${dmarc}`);
    return false;
  }
  const note = policy === 'none'
    ? 'Monitoring only (p=none). Fine to start; tighten to quarantine/reject later.'
    : `Enforcing (p=${policy}).`;
  const ruaNote = hasRua ? '' : ' No rua= reporting address set — you will not receive reports.';
  line(tag.pass, 'DMARC', `${note}${ruaNote}\n       ${dmarc}`);
  return true;
}

async function main() {
  console.log(`\n${c.bold}Email authentication check: ${DOMAIN}${c.reset}`);
  console.log(`${c.dim}DKIM selector tested: ${DKIM_SELECTOR}${c.reset}\n`);

  const results = [];
  results.push(await checkSPF());
  results.push(await checkDKIM());
  results.push(await checkDMARC());

  const allPass = results.every(Boolean);
  console.log('');
  if (allPass) {
    console.log(`${c.green}${c.bold}All three passed. Safe to scale outbound.${c.reset}\n`);
  } else {
    console.log(`${c.yellow}${c.bold}One or more checks failed. Fix before scaling email volume.${c.reset}`);
    console.log(`${c.dim}DNS changes can take up to 48h to propagate — re-run after that.${c.reset}\n`);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(`${c.red}Unexpected error:${c.reset}`, err.message);
  process.exit(2);
});
