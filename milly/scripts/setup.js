'use strict';

// setup validator — run this before starting Milly for the first time
// checks all required env vars and reports missing ones in plain English
// never crashes — exits 0 if everything is fine, exits 1 if blockers exist

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const REQUIRED = [
  {
    key:  'ANTHROPIC_API_KEY',
    label: 'Claude API key',
    help:  'Get at console.anthropic.com → API keys',
    blocker: true,
  },
];

const OPTIONAL = [
  {
    key:  'POSTPEER_API_KEY',
    label: 'PostPeer API key',
    help:  'Get at postpeer.dev — needed for auto-posting. Without it, posts go to /output/queue/ for manual publishing.',
  },
  {
    key:  'POSTPEER_ACCOUNT_ID',
    label: 'PostPeer account ID',
    help:  'Found in PostPeer dashboard after connecting your Instagram account.',
  },
  {
    key:  'INSTAGRAM_ACCESS_TOKEN',
    label: 'Instagram Graph API token',
    help:  'Get from Meta Developer dashboard. Only needed for analytics — skip at launch.',
  },
  {
    key:  'INSTAGRAM_BUSINESS_ACCOUNT_ID',
    label: 'Instagram Business account ID',
    help:  'Found in Meta Developer dashboard. Only needed for analytics.',
  },
  {
    key:  'SERPAPI_KEY',
    label: 'SerpApi key (for live research)',
    help:  'Free tier at serpapi.com. Without it, researcher uses evergreen fallback.',
  },
];

const EXPECTED_DIRS = [
  'output/briefs',
  'output/content',
  'output/images',
  'output/queue',
  'output/archive',
];

function check() {
  const root = path.join(__dirname, '..');
  let hasBlocker = false;

  console.log('\nMilly setup check\n' + '─'.repeat(40));

  // check .env file exists
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    console.log('\n⚠  No .env file found.');
    console.log('   Copy .env.example to .env and fill in your values:');
    console.log('   cp .env.example .env\n');
  }

  // check required env vars
  console.log('\nRequired:');
  let allRequired = true;
  for (const item of REQUIRED) {
    const val = process.env[item.key];
    if (val) {
      console.log(`  ✓  ${item.label}`);
    } else {
      console.log(`  ✗  ${item.label} — missing`);
      console.log(`     ${item.help}`);
      if (item.blocker) {
        hasBlocker = true;
        allRequired = false;
      }
    }
  }

  // check optional env vars
  console.log('\nOptional:');
  for (const item of OPTIONAL) {
    const val = process.env[item.key];
    if (val) {
      console.log(`  ✓  ${item.label}`);
    } else {
      console.log(`  –  ${item.label} — not set`);
      console.log(`     ${item.help}`);
    }
  }

  // check output directories exist
  console.log('\nDirectories:');
  for (const dir of EXPECTED_DIRS) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) {
      console.log(`  ✓  ${dir}`);
    } else {
      fs.mkdirSync(full, { recursive: true });
      console.log(`  ✓  ${dir} — created`);
    }
  }

  // check evergreen bank
  const evergreenPath = path.join(root, 'templates', 'evergreen.json');
  console.log('\nContent bank:');
  if (fs.existsSync(evergreenPath)) {
    const data = JSON.parse(fs.readFileSync(evergreenPath, 'utf8'));
    const count = data.posts ? data.posts.length : 0;
    console.log(`  ✓  Evergreen bank — ${count} posts loaded`);
  } else {
    console.log('  –  Evergreen bank not generated yet');
    console.log('     Run: node scripts/generate-evergreen.js');
  }

  // final status
  console.log('\n' + '─'.repeat(40));
  if (hasBlocker) {
    console.log('Setup incomplete. Fix the items marked ✗ above before running Milly.\n');
    process.exit(1);
  } else {
    console.log('Setup looks good.');
    if (!process.env.POSTPEER_API_KEY) {
      console.log('Note: PostPeer not configured — posts will go to /output/queue/ for manual publishing.');
    }
    if (!process.env.INSTAGRAM_ACCESS_TOKEN) {
      console.log('Note: Instagram analytics not configured — analyst will skip gracefully.');
    }
    console.log('\nReady to run: node scripts/test-pipeline.js\n');
    process.exit(0);
  }
}

check();
