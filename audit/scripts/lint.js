#!/usr/bin/env node
// Minimal lint pass for /audit — the repo has no shared ESLint config, so this checks every
// JS file in /audit parses cleanly via `node --check`. Kept deliberately lightweight.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = path.join(__dirname, '..');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'output') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

let failed = false;
for (const file of walk(AUDIT_ROOT)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    console.error(`Syntax issue in ${path.relative(AUDIT_ROOT, file)}:\n${err.stderr?.toString() || err.message}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('Lint passed: all /audit JS files parse cleanly.');
}
