#!/usr/bin/env node
/**
 * Syncs Merlin's "Dave's tasks" (browser/vendor-dashboard/phone items the
 * agent can't do) from the latest nightly report into the macOS Reminders
 * "Claude" list, via the `reminders` CLI (~/.local/bin/reminders).
 *
 * Reads the report file directly from disk — no Gmail access needed, since
 * merlin/run.js already writes the same content Merlin emails.
 *
 * Mac only (Reminders.app via AppleScript). Not run in CI.
 *
 * Usage:
 *   node merlin/sync-reminders.js              # sync latest report
 *   node merlin/sync-reminders.js --dry-run    # show what would be added, don't add
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPORTS_DIR = path.join(__dirname, 'reports');
const REMINDERS_LIST = 'Claude';

function latestReportDir() {
  const dates = fs.readdirSync(REPORTS_DIR).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
  if (dates.length === 0) throw new Error(`No dated report directories found under ${REPORTS_DIR}`);
  return path.join(REPORTS_DIR, dates[dates.length - 1]);
}

// Matches the fixed "### Dave's tasks" numbered format session-prompt.js renders:
//   1. **Task title** (~0.1h)
//      description...
function parseDavesTasks(sessionPrimaryMd) {
  const section = sessionPrimaryMd.split(/^### Dave's tasks.*$/m)[1];
  if (!section) return [];
  const tasks = [];
  const re = /^\d+\.\s+\*\*(.+?)\*\*\s+\(~([\d.]+h)\)/gm;
  let match;
  while ((match = re.exec(section)) !== null) {
    tasks.push({ title: match[1].trim(), estimate: match[2].trim() });
  }
  return tasks;
}

// Dedupes against EVERY reminder in the list, completed or not — `reminders show`
// only lists incomplete ones, which would resurrect a task the moment Dave checks
// it off. A task only stops getting offered once Merlin itself stops recommending
// it (resolved/superseded) or Dave marks the reminder complete — not by deleting it,
// since that's indistinguishable here from "never added."
function existingReminderTitles() {
  const script = `
tell application "Reminders"
  set out to ""
  repeat with r in (reminders of list "${REMINDERS_LIST}")
    set out to out & (name of r) & linefeed
  end repeat
  return out
end tell`;
  const out = execFileSync('osascript', ['-e', script], { encoding: 'utf8' });
  return out.split('\n').map(line => line.trim()).filter(Boolean);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  const reportDir = latestReportDir();
  const sessionPrimaryMd = fs.readFileSync(path.join(reportDir, 'session-primary.md'), 'utf8');
  const tasks = parseDavesTasks(sessionPrimaryMd);

  console.log(`Report: ${reportDir}`);
  console.log(`Dave's tasks found: ${tasks.length}`);

  if (tasks.length === 0) return;

  const existing = existingReminderTitles();

  for (const task of tasks) {
    const text = `${task.title} (~${task.estimate})`;
    const alreadyThere = existing.some(line => line.includes(task.title));
    if (alreadyThere) {
      console.log(`  skip (already in ${REMINDERS_LIST}): ${task.title}`);
      continue;
    }
    if (dryRun) {
      console.log(`  would add: ${text}`);
      continue;
    }
    execFileSync('reminders', ['add', text], { encoding: 'utf8' });
    console.log(`  added: ${text}`);
  }
}

main();
