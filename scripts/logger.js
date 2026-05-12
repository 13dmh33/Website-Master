const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

function writeLog(agent, lines) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const date  = new Date().toISOString().split('T')[0];
  const ts    = new Date().toISOString();
  const entry = [`[${ts}] ${agent.toUpperCase()}`, ...lines.map(l => `  ${l}`)].join('\n') + '\n\n';
  fs.appendFileSync(path.join(LOGS_DIR, `${date}.log`), entry);
}

module.exports = { writeLog };
