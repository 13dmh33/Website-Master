'use strict';

// test pipeline — full dry run of the Miley (Techs4Tatas) pipeline.
// researcher → generator → designer → scheduler, never posts (FORCE_QUEUE=1).
// If ANTHROPIC_API_KEY is absent, runs the evergreen path (zero spend).
// usage: node scripts/test-pipeline.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const store = require('../lib/store');

const ROOT = path.join(__dirname, '..');

function run(scriptPath, label, env) {
  console.log(`\n${'─'.repeat(50)}\nRunning: ${label}\n${'─'.repeat(50)}`);
  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: ROOT, env });
    return true;
  } catch (err) {
    console.error(`${label} failed with exit code ${err.status}`);
    return false;
  }
}

async function main() {
  console.log('\nMiley test pipeline — dry run (never posts to Instagram)\n');

  const useEvergreen = !process.env.ANTHROPIC_API_KEY;
  if (useEvergreen) {
    console.log('No ANTHROPIC_API_KEY — running the evergreen path (zero spend).\n');
  }

  // FORCE_QUEUE=1 keeps the scheduler in review-queue mode (no posting).
  const env = { ...process.env, FORCE_QUEUE: '1', ...(useEvergreen ? { FORCE_EVERGREEN: '1' } : {}) };

  const steps = [
    { script: path.join(ROOT, 'agents', 'researcher.js'), label: 'Researcher (brief)' },
    { script: path.join(ROOT, 'agents', 'generator.js'),  label: 'Generator (write posts)' },
    { script: path.join(ROOT, 'agents', 'designer.js'),   label: 'Designer (render images)' },
    { script: path.join(ROOT, 'agents', 'scheduler.js'),  label: 'Scheduler (queue + preview)' },
  ];

  for (const step of steps) {
    if (!run(step.script, step.label, env)) {
      console.log(`\nPipeline stopped at: ${step.label}\n`);
      process.exit(1);
    }
  }

  const content = store.getLatestContent();
  console.log(`\n${'═'.repeat(50)}\nTest pipeline complete\n${'═'.repeat(50)}`);
  if (content) {
    console.log(`\nWeek of ${content.weekOf} · ${content.campaignMode} mode · ${content.posts.length} posts:`);
    for (const p of content.posts) {
      console.log(`\n[${p.day} ${p.time} · ${p.contentType} · ${p.format}${p.product ? ' · ' + p.product : ''}] (${p.source})`);
      console.log(p.caption.slice(0, 160).replace(/\n/g, ' '));
      console.log(`tags: ${(p.hashtags || []).join(' ')}`);
    }
  }

  const qDir = store.paths.queue;
  const previews = fs.existsSync(qDir) ? fs.readdirSync(qDir).filter(f => f.startsWith('preview-') && f.endsWith('.html')) : [];
  if (previews.length) {
    console.log(`\nPreview (open in a browser):\n  ${path.join(qDir, previews[previews.length - 1])}`);
  }
  console.log('\nReview the preview, then (when Buffer is set) run: node scripts/push-queue.js\n');
}

main().catch(err => {
  console.error(`Test pipeline failed: ${err.message}`);
  process.exit(1);
});
