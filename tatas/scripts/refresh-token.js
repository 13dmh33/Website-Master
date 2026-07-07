'use strict';

// refresh-token.js — keeps the Instagram-Login access token alive.
// Adapted from Miley's proven module; refreshes TATAS_IG_TOKEN.
//
// "Instagram API with Instagram Login" long-lived tokens expire after 60 days.
// Refreshing (token must be ≥24h old and unexpired) returns a NEW token good
// for another 60 days. The tatas-token-refresh workflow runs this twice a
// month so the token never lapses. Facebook-Login mode doesn't need this
// (Page-derived tokens don't expire) — the script exits early there.
//
// usage:
//   node scripts/refresh-token.js            # refresh, show expiry + masked token
//   node scripts/refresh-token.js --write    # also update TATAS_IG_TOKEN in tatas/.env
//   node scripts/refresh-token.js --print    # emit ONLY the new token on stdout (for CI; mask it!)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');
const { MODE } = require('../lib/ig-config');

const WRITE = process.argv.includes('--write');
const PRINT = process.argv.includes('--print');

function log(msg) { if (!PRINT) console.log(msg); } // keep stdout clean in --print mode

async function main() {
  if (MODE === 'facebook') {
    log('TATAS_IG_API_MODE=facebook — Page-derived tokens do not expire; nothing to refresh.');
    return;
  }

  const token = process.env.TATAS_IG_TOKEN;
  if (!token) {
    console.error('TATAS_IG_TOKEN is not set.');
    process.exit(1);
  }

  // refresh lives on the unversioned root of graph.instagram.com
  const qs  = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.access_token) {
    const msg = data.error ? data.error.message : `HTTP ${res.status}`;
    console.error(`Token refresh failed: ${msg}`);
    console.error('If the token already expired, generate a fresh one in the Meta app dashboard (API setup with Instagram login).');
    process.exit(1);
  }

  const newToken = data.access_token;
  const days     = Math.round((data.expires_in || 0) / 86400);
  log(`✓ Token refreshed — valid ~${days} days. New token: ${newToken.slice(0, 4)}…${newToken.slice(-4)}`);

  if (WRITE) {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, 'utf8');
      const updated = env.match(/^TATAS_IG_TOKEN=.*$/m)
        ? env.replace(/^TATAS_IG_TOKEN=.*$/m, `TATAS_IG_TOKEN=${newToken}`)
        : env + `\nTATAS_IG_TOKEN=${newToken}\n`;
      fs.writeFileSync(envPath, updated, 'utf8');
      log('✓ tatas/.env updated.');
    } else {
      log('No tatas/.env found — copy the token from the Meta dashboard flow instead.');
    }
  }

  if (PRINT) process.stdout.write(newToken);
  else if (!WRITE) log('Remember to update the TATAS_IG_TOKEN GitHub Actions secret (the workflow does this automatically).');
}

main().catch(err => {
  console.error(`refresh-token failed: ${err.message}`);
  process.exit(1);
});
