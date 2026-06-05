'use strict';

// setup validator for Molly — run before first use
// checks env vars and directories, reports what's missing

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const REQUIRED = [
  {
    key:     'ANTHROPIC_API_KEY',
    label:   'Claude API key',
    help:    'Get at console.anthropic.com → API keys',
    blocker: true,
  },
];

const OPTIONAL = [
  {
    key:   'BUFFER_ACCESS_TOKEN',
    label: 'Buffer access token',
    help:  'Get at buffer.com/developers — needed for auto-posting. Without it, posts go to output/queue/ for manual publishing.',
  },
  {
    key:   'INSTAGRAM_ACCESS_TOKEN',
    label: 'Instagram Graph API token',
    help:  'From Meta Developer dashboard. Only needed for analytics — skip at launch.',
  },
  {
    key:   'INSTAGRAM_BUSINESS_ACCOUNT_ID',
    label: 'Instagram Business account ID',
    help:  'From Meta Developer dashboard. Only needed for analytics.',
  },
  {
    key:   'SERPAPI_KEY',
    label: 'SerpApi key (live research)',
    help:  'Free tier at serpapi.com. Without it, researcher uses evergreen fallback — still works.',
  },
  {
    key:   'UNSPLASH_ACCESS_KEY',
    label: 'Unsplash access key (photo backgrounds)',
    help:  'Free at unsplash.com/developers. Without it, designer uses gradient backgrounds — still looks great.',
  },
];

const EXPECTED_DIRS = [
  'output/briefs', 'output/content', 'output/images', 'output/queue', 'output/archive',
];

function check() {
  const root = path.join(__dirname, '..');
  let hasBlocker = false;

  console.log('\nMolly setup check — Trevo Advisors content engine\n' + '─'.repeat(50));

  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    console.log('\n⚠  No .env file found.');
    console.log('   Copy .env.example to .env and fill in your values:');
    console.log('   cp .env.example .env\n');
  }

  console.log('\nRequired:');
  for (const item of REQUIRED) {
    if (process.env[item.key]) {
      console.log(`  ✓  ${item.label}`);
    } else {
      console.log(`  ✗  ${item.label} — missing`);
      console.log(`     ${item.help}`);
      if (item.blocker) hasBlocker = true;
    }
  }

  console.log('\nOptional:');
  for (const item of OPTIONAL) {
    if (process.env[item.key]) {
      console.log(`  ✓  ${item.label}`);
    } else {
      console.log(`  –  ${item.label} — not set`);
      console.log(`     ${item.help}`);
    }
  }

  console.log('\nDirectories:');
  for (const dir of EXPECTED_DIRS) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
    console.log(`  ✓  ${dir}`);
  }

  const evergreenPath = path.join(root, 'templates', 'evergreen.json');
  console.log('\nContent bank:');
  if (fs.existsSync(evergreenPath)) {
    const data  = JSON.parse(fs.readFileSync(evergreenPath, 'utf8'));
    const count = data.posts ? data.posts.length : 0;
    console.log(`  ✓  Evergreen bank — ${count} posts loaded`);
  } else {
    console.log('  –  Evergreen bank not found');
    console.log('     Run: node scripts/generate-evergreen.js');
  }

  console.log('\n' + '─'.repeat(50));
  if (hasBlocker) {
    console.log('Setup incomplete. Fix items marked ✗ before running Molly.\n');
    process.exit(1);
  } else {
    console.log('Setup looks good. Ready to run:');
    console.log('  node agents/researcher.js');
    console.log('  node agents/generator.js');
    console.log('  node agents/designer.js');
    console.log('  node agents/scheduler.js\n');
    process.exit(0);
  }
}

check();
