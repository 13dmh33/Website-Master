'use strict';

// setup validator (Techs4Tatas / Miley) — run before first use.
// Checks env vars + templates + directories. Never spends money.
// exits 0 if runnable (evergreen dry-run always works), 1 only on hard blockers.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const OPTIONAL = [
  { key: 'ANTHROPIC_API_KEY', label: 'Claude API key', help: 'console.anthropic.com → API keys. Without it, the pipeline uses evergreen.json content (zero spend).' },
  { key: 'BUFFER_ACCESS_TOKEN', label: 'Buffer classic token', help: 'buffer.com/developers → Generate Access Token (NOT the MCP/OIDC token — it 401s). Needed only to auto-post; otherwise posts wait in the review queue.' },
  { key: 'BUFFER_INSTAGRAM_PROFILE_ID', label: 'Buffer Instagram profile ID', help: 'GET https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN → the Instagram profile id.' },
  { key: 'FORCE_QUEUE', label: 'Review-first flag (FORCE_QUEUE=1)', help: 'Keep this set to 1 so nothing auto-posts — everything lands in the review queue (see docs/review-workflow.md).' },
  { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Instagram Graph token', help: 'Analytics only. Analyst skips gracefully without it.' },
  { key: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', label: 'Instagram Business account ID', help: 'Analytics only.' },
];

const EXPECTED_DIRS = ['output/briefs', 'output/content', 'output/images', 'output/queue', 'output/archive', 'assets/products', 'assets/lifestyle', 'assets/fonts'];
const REQUIRED_TEMPLATES = ['brand-voice.json', 'post-formats.json', 'evergreen.json', 'trades-glossary.json', 'hashtag-master.json', 'october-campaign.json', 'visual-config.json', 'inspiration-sources.json'];

function check() {
  const root = path.join(__dirname, '..');
  let hasBlocker = false;

  console.log('\nMiley (Techs4Tatas) setup check\n' + '─'.repeat(44));

  if (!fs.existsSync(path.join(root, '.env'))) {
    console.log('\n⚠  No .env file. Copy the template:  cp .env.example .env\n');
  }

  console.log('\nEnv vars (all optional — evergreen dry-run needs none):');
  for (const item of OPTIONAL) {
    console.log(process.env[item.key] ? `  ✓  ${item.label}` : `  –  ${item.label} — not set\n     ${item.help}`);
  }

  console.log('\nTemplates:');
  for (const t of REQUIRED_TEMPLATES) {
    const p = path.join(root, 'templates', t);
    if (fs.existsSync(p)) {
      console.log(`  ✓  ${t}`);
    } else {
      console.log(`  ✗  ${t} — MISSING (required)`);
      hasBlocker = true;
    }
  }

  console.log('\nDirectories:');
  for (const dir of EXPECTED_DIRS) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) console.log(`  ✓  ${dir}`);
    else { fs.mkdirSync(full, { recursive: true }); console.log(`  ✓  ${dir} — created`); }
  }

  const evergreenPath = path.join(root, 'templates', 'evergreen.json');
  console.log('\nContent bank:');
  if (fs.existsSync(evergreenPath)) {
    const data = JSON.parse(fs.readFileSync(evergreenPath, 'utf8'));
    console.log(`  ✓  Evergreen bank — ${data.posts ? data.posts.length : 0} posts`);
  } else {
    console.log('  ✗  Evergreen bank missing');
    hasBlocker = true;
  }

  console.log('\n' + '─'.repeat(44));
  if (hasBlocker) {
    console.log('Setup incomplete — fix the ✗ items above.\n');
    process.exit(1);
  }
  console.log('Setup looks good.');
  if (!process.env.ANTHROPIC_API_KEY) console.log('Note: no Claude key — pipeline will use evergreen content (free).');
  if (!process.env.BUFFER_ACCESS_TOKEN) console.log('Note: no Buffer token — posts go to the review queue for manual approval.');
  console.log('\nReady: node scripts/test-pipeline.js\n');
  process.exit(0);
}

check();
