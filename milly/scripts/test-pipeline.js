'use strict';

// test pipeline — dry run of the full Milly pipeline
// runs researcher → generator → designer → scheduler (queue fallback only, never posts)
// outputs everything to /output/ for review
// usage: node scripts/test-pipeline.js

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');
const path         = require('path');
const store        = require('../lib/store');

const ROOT = path.join(__dirname, '..');

// run a script and stream its output to console
function run(scriptPath, label) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Running: ${label}`);
  console.log('─'.repeat(50));
  try {
    execSync(`node "${scriptPath}"`, {
      stdio: 'inherit',
      cwd:   ROOT,
      env:   { ...process.env, FORCE_QUEUE: '1' }, // force queue fallback in scheduler
    });
    return true;
  } catch (err) {
    console.error(`${label} failed with exit code ${err.status}`);
    return false;
  }
}

async function main() {
  console.log('\nMilly test pipeline — dry run\n');
  console.log('This runs the full pipeline without posting to Instagram.');
  console.log('All output is saved to /output/ for your review.\n');

  // check ANTHROPIC_API_KEY at minimum
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is required. Add it to .env and try again.');
    process.exit(1);
  }

  const steps = [
    { script: path.join(ROOT, 'agents', 'researcher.js'), label: 'Researcher (build brief)' },
    { script: path.join(ROOT, 'agents', 'generator.js'),  label: 'Generator (4 Claude API calls)' },
    { script: path.join(ROOT, 'agents', 'designer.js'),   label: 'Designer (render images)' },
    { script: path.join(ROOT, 'agents', 'scheduler.js'),  label: 'Scheduler (save to queue)' },
  ];

  let allPassed = true;
  for (const step of steps) {
    const ok = run(step.script, step.label);
    if (!ok) {
      allPassed = false;
      console.log(`\nPipeline stopped at: ${step.label}`);
      console.log('Fix the error above, then re-run node scripts/test-pipeline.js\n');
      process.exit(1);
    }
  }

  if (allPassed) {
    // show summary
    const content = store.getLatestContent();
    const brief   = store.getLatestBrief();

    console.log(`\n${'═'.repeat(50)}`);
    console.log('Test pipeline complete — here\'s what was generated:');
    console.log('═'.repeat(50));

    if (brief) {
      console.log(`\nResearch mode: ${brief.researchMode}`);
      console.log(`Angles found: ${brief.angles.length}`);
      console.log(`Conferences found: ${brief.conferencesFound?.length || 0}`);
    }

    if (content) {
      console.log(`\nContent for week of ${content.weekOf}:`);
      console.log('\n[Carousel caption]:');
      console.log(content.posts.carousel.caption.slice(0, 200));
      console.log('\n[Caption (pain-point)]:');
      console.log(content.posts.caption1.body.slice(0, 200));
      console.log('\n[Reeve found]:');
      console.log(content.posts.reevefound.body.slice(0, 200));
      console.log('\n[Reel script]:');
      console.log(content.posts.reel.script.slice(0, 200));
    }

    const pending = store.getPendingQueue();
    if (pending.length) {
      console.log(`\n${pending.length} posts saved to /output/queue/ (pending manual push)`);

      // check for preview HTML
      const fs     = require('fs');
      const qDir   = store.paths.queue;
      const previews = fs.existsSync(qDir)
        ? fs.readdirSync(qDir).filter(f => f.startsWith('preview-') && f.endsWith('.html'))
        : [];
      if (previews.length) {
        console.log(`\nPreview: open this file in your browser to review the week's content:`);
        console.log(`  ${path.join(qDir, previews[previews.length - 1])}`);
      }
    }

    console.log('\nNext step: review the content above, then run node agents/scheduler.js to post live.\n');
  }
}

main().catch(err => {
  console.error(`Test pipeline failed: ${err.message}`);
  process.exit(1);
});
