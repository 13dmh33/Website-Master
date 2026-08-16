// config.js — loads .env and exposes a single, validated config object.
//
// Every stage imports `config` from here so there is one place that knows the
// defaults and one place that reports which features are enabled. Nothing here
// throws on a missing key: a blank value just marks that feature disabled, and
// the stage that needs it prints a clear "skipping X (no key)" line instead of
// crashing. This keeps the pipeline runnable end-to-end even before Dave has
// every account set up.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root = job-hunter/ (one level up from src/).
export const ROOT = path.resolve(__dirname, '..', '..');

const num = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v) => (v && String(v).trim() ? String(v).trim() : '');

// Explicit both ways: an unset value takes the fallback, and only the listed
// words flip it. Anything else is a typo, and a typo in a flag that governs
// spending should not quietly read as "on".
const bool = (v, fallback) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
};

export const config = {
  // Paths
  paths: {
    root: ROOT,
    inputs: path.join(ROOT, 'inputs'),
    data: path.join(ROOT, 'data'),
    out: path.join(ROOT, 'out'),
    logs: path.join(ROOT, 'logs'),
    masterProfile: path.join(ROOT, 'data', 'master-profile.json'),
    preferences: path.join(ROOT, 'inputs', 'preferences.md'),
    state: path.join(ROOT, 'state.json'),
  },

  // Claude
  anthropicKey: str(process.env.ANTHROPIC_API_KEY),
  models: {
    // Spec: cheap Haiku for scoring the shortlist, Sonnet for tailoring the
    // above-threshold jobs. Free rules filter runs before either.
    scorer: 'claude-haiku-4-5',
    tailor: 'claude-sonnet-5',
  },

  // Adzuna
  adzuna: {
    appId: str(process.env.ADZUNA_APP_ID),
    appKey: str(process.env.ADZUNA_APP_KEY),
  },

  // USAJobs (optional / federal)
  usajobs: {
    apiKey: str(process.env.USAJOBS_API_KEY),
    email: str(process.env.USAJOBS_EMAIL),
  },

  // Email (Zoho SMTP)
  email: {
    host: str(process.env.ZOHO_SMTP_HOST) || 'smtp.zoho.com',
    port: num(process.env.ZOHO_SMTP_PORT, 465),
    user: str(process.env.ZOHO_SMTP_USER),
    pass: str(process.env.ZOHO_SMTP_PASS),
    to: str(process.env.DIGEST_TO) || 'dave@trevoadvisors.com',
    signature: str(process.env.SIGNATURE_NAME) || 'Dave Hettinger',
  },

  // Google Sheet tracker
  sheets: {
    serviceAccountJson: str(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    sheetId: str(process.env.SHEET_ID),
  },

  // Tunables
  minScore: num(process.env.MIN_SCORE, 70),
  dailyLimit: num(process.env.DAILY_LIMIT, 8),
  // Stage 4 (Sonnet resume + cover letter) is off by default. It is the largest
  // cost in the pipeline and its output has never been used; scores, rationales,
  // the keywords to mirror and the career-coach review all come from elsewhere
  // and are unaffected. Setting DAILY_LIMIT=0 would also stop it, but a zero is
  // not legible — six months on, nobody knows whether it was a decision or a
  // mistake. This flag says what it means, and leaves DAILY_LIMIT free to go on
  // doing its real job of capping how many matches get tailored when it is on.
  tailorEnabled: bool(process.env.TAILOR_ENABLED, false),
  maxAgeDays: num(process.env.MAX_AGE_DAYS, 21),
  // Off unless a numeric threshold is set.
  instantAlertMin:
    str(process.env.INSTANT_ALERT_MIN) === '' ? null : num(process.env.INSTANT_ALERT_MIN, null),
};

// Small helpers so stages can report capability cleanly.
export const has = {
  claude: () => !!config.anthropicKey,
  adzuna: () => !!(config.adzuna.appId && config.adzuna.appKey),
  usajobs: () => !!(config.usajobs.apiKey && config.usajobs.email),
  email: () => !!(config.email.user && config.email.pass),
  sheets: () => !!(config.sheets.serviceAccountJson && config.sheets.sheetId),
};
