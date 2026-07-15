// log.js — tiny, dependency-free logger.
//
// Prints to the terminal with a consistent prefix per stage, and (best effort)
// appends the same lines to logs/<date>.log so a cron run leaves a paper trail.
// No emojis anywhere, sentence case, per the project rules.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function write(line) {
  try {
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.appendFileSync(path.join(config.paths.logs, `${today()}.log`), line + '\n');
  } catch {
    // Logging must never break the pipeline.
  }
}

export function makeLogger(stage) {
  const tag = `[${stage}]`;
  const emit = (level, args) => {
    const msg = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    const line = `${new Date().toISOString()} ${tag} ${msg}`;
    if (level === 'error') console.error(`${tag} ${msg}`);
    else console.log(`${tag} ${msg}`);
    write(line);
  };
  return {
    info: (...a) => emit('info', a),
    warn: (...a) => emit('info', ['(warn)', ...a]),
    error: (...a) => emit('error', a),
  };
}
