#!/usr/bin/env node
/**
 * Brand-standard linter — Tier 2.3. Fails (exit 1) on any hit.
 *
 * Usage:
 *   node scripts/lint-brand-standards.js                 # default scope (see below)
 *   node scripts/lint-brand-standards.js proposals/out/some-lead.html
 *
 * Default scope:
 *   Customer-facing rendered output — proposals/out/*.html, website/**\/*.html
 *     checked for: emojis, "bot", "business day(s)"
 *   Source that generates customer-facing copy — scripts/lib/proposal/*.js
 *     checked for: hardcoded founder name (should come from SIGNATURE_NAME, not a literal)
 */

const fs = require('fs');
const path = require('path');
const { checkCustomerFacingText, checkSourceForHardcodedName } = require('./lib/brand-lint');

const ROOT = path.join(__dirname, '..');

function walk(dir, extFilter) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extFilter));
    else if (extFilter(entry.name)) out.push(full);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  let findings = [];

  if (args.length > 0) {
    for (const arg of args) {
      const text = fs.readFileSync(arg, 'utf8');
      findings.push(...checkCustomerFacingText(text, arg));
    }
  } else {
    const htmlFiles = [
      ...walk(path.join(ROOT, 'proposals', 'out'), f => f.endsWith('.html')),
      ...walk(path.join(ROOT, 'website'), f => f.endsWith('.html')),
    ];
    for (const file of htmlFiles) {
      const text = fs.readFileSync(file, 'utf8');
      findings.push(...checkCustomerFacingText(text, path.relative(ROOT, file)));
    }

    const sourceFiles = walk(path.join(ROOT, 'scripts', 'lib', 'proposal'), f => f.endsWith('.js'));
    for (const file of sourceFiles) {
      const text = fs.readFileSync(file, 'utf8');
      findings.push(...checkSourceForHardcodedName(text, path.relative(ROOT, file)));
    }
  }

  if (findings.length === 0) {
    console.log('Brand-standard lint: clean.');
    process.exit(0);
  }

  console.error('Brand-standard lint failed:');
  findings.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}

main();
