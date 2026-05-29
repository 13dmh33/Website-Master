#!/usr/bin/env node
/**
 * Checker — quality-gates cold messages before Pitcher sends them
 *
 * Usage:
 *   node scripts/checker.js --force
 *   node scripts/checker.js --limit 10 --force
 *
 * Reads:  queue/*-brief.json     (Diagnoser output, checker_approved = false)
 *         config/checker-config.json
 *         .env.local             (ANTHROPIC_API_KEY)
 * Writes: queue/*-brief.json     (updates checker_approved, final_message, scores)
 *         state.json             (status: diagnosed → checked)
 *         config/checker-config.json (spend tracking)
 *
 * Flow per message:
 *   1. Run 4 local evals (no API call)
 *   2. If all pass → approve, done
 *   3. If any fail → ask Claude to rewrite → re-run evals
 *   4. Max 2 rewrite attempts → flag for human review if still failing
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { writeLog } = require('./logger');

// ── PATHS ─────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'checker-config.json');
const STATE_PATH  = path.join(ROOT, 'state.json');
const QUEUE_DIR   = path.join(ROOT, 'queue');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);
const limitArg = parseInt(getArg('--limit') || '0', 10);

// ── CONFIG ────────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().split('T')[0]; }
function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      daily_limit: 30,
      monthly_cap: 3.00,
      auto_run: false,
      model: 'claude-haiku-4-5-20251001',
      rates: {
        input_per_mtok: 0.80,
        output_per_mtok: 4.00,
        cache_write_per_mtok: 1.00,
        cache_read_per_mtok: 0.08
      },
      current_month: currentMonth(),
      spent_this_month: 0.00,
      today: today(),
      processed_today: 0,
      total_processed: 0,
      approved_total: 0,
      flagged_total: 0,
      last_run: null
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function checkAutoRun(config) {
  if (hasFlag('--force')) return;
  if (!config.auto_run) {
    console.log('Checker is in manual mode (auto_run = false).');
    console.log('Run with --force, or set auto_run = true in config/checker-config.json.');
    process.exit(0);
  }
}

function checkLimits(config) {
  if (config.today !== today()) { config.today = today(); config.processed_today = 0; }
  if (config.current_month !== currentMonth()) {
    config.current_month = currentMonth();
    config.spent_this_month = 0;
    console.log('New month — spend counter reset.');
  }

  if (config.processed_today >= config.daily_limit) {
    console.error(`DAILY LIMIT: ${config.processed_today}/${config.daily_limit} already processed today.`);
    process.exit(1);
  }
  if (config.spent_this_month >= config.monthly_cap) {
    console.error(`MONTHLY CAP: $${config.spent_this_month.toFixed(4)}/$${config.monthly_cap.toFixed(2)} used.`);
    process.exit(1);
  }

  let effective = config.daily_limit - config.processed_today;
  if (limitArg > 0) effective = Math.min(effective, limitArg);
  return effective;
}

function calcCost(usage, rates) {
  return (usage.input_tokens || 0)                / 1_000_000 * rates.input_per_mtok
       + (usage.output_tokens || 0)               / 1_000_000 * rates.output_per_mtok
       + (usage.cache_creation_input_tokens || 0) / 1_000_000 * rates.cache_write_per_mtok
       + (usage.cache_read_input_tokens || 0)     / 1_000_000 * rates.cache_read_per_mtok;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── LOAD BRIEFS ───────────────────────────────────────────────────────────────

function loadUncheckedBriefs() {
  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-brief.json'));
  const briefs = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'));
      // Only process briefs that haven't been checked yet
      if (!data.checker_approved && data.checker_flag !== 'human_review') {
        briefs.push({ file, data });
      }
    } catch (e) {
      console.warn(`Could not read ${file}: ${e.message}`);
    }
  }

  // Priority briefs first
  return briefs.sort((a, b) => {
    if (a.data.priority && !b.data.priority) return -1;
    if (!a.data.priority && b.data.priority) return 1;
    return (b.data.gap_score || 0) - (a.data.gap_score || 0);
  });
}

// ── EVAL ENGINE (local — no API call) ────────────────────────────────────────

const AI_MARKERS = [
  "certainly!", "as an ai", "i'd be happy to", "great question",
  "of course!", "absolutely!", "i hope this message finds you well",
  "i wanted to reach out", "touch base", "circle back",
  "hope you're doing well", "i hope this finds you"
];

const BUZZWORDS = [
  "game-changing", "cutting-edge", "seamlessly", "leverage", "synergy",
  "revolutionize", "disruptive", "innovative solution", "next-level",
  "empower", "transformative", "streamline", "best-in-class",
  "robust", "scalable", "ecosystem", "holistic"
];

const SPAMMY_OPENERS = [
  "i noticed your business",
  "i came across your",
  "i stumbled upon your",
  "i'd love to help you grow",
  "i'd love to help your business",
  "are you looking to grow",
  "are you looking to take your",
  "i wanted to reach out",
  "i'm reaching out because",
  "i recently came across",
  "i hope you don't mind",
  "sorry to bother you",
  "i know you're busy"
];

// Trade synonym map — natural language a message might use instead of the exact trade keyword
const TRADE_SYNONYMS = {
  plumber:     ['plumber', 'plumbing', 'pipe', 'drain', 'water heater', 'sewer'],
  hvac:        ['hvac', 'air conditioning', 'heating', 'cooling', 'furnace', 'ac unit', 'heat pump', 'ductwork'],
  electrician: ['electrician', 'electrical', 'wiring', 'electric', 'panel'],
  roofer:      ['roofer', 'roofing', 'roof', 'shingles', 'gutters'],
  handyman:    ['handyman', 'handymen', 'repairs', 'home repair', 'maintenance', 'fix']
};

// Fix 1: Trade synonym matching + Fix 5: separate name vs city signals
function evalPersonalization(message, brief) {
  const msg = message.toLowerCase();

  // City words — used to detect local signal AND to exclude from name check
  const cityWords = new Set(
    brief.city.toLowerCase().split(/[,\s]+/).filter(w => w.length > 2)
  );

  // Name check: only words that are NOT also city words, and longer than 3 chars
  const nameWords = brief.business_name
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !cityWords.has(w) && !['hvac', 'plumbing', 'electric', 'roofing'].includes(w));

  const hasName  = nameWords.length > 0 && nameWords.some(w => msg.includes(w));

  // Fix 1: check synonyms, not just exact trade keyword
  const synonyms = TRADE_SYNONYMS[brief.trade.toLowerCase()] || [brief.trade.toLowerCase()];
  const hasTrade = synonyms.some(s => msg.includes(s));

  const hasLocal = [...cityWords].some(w => msg.includes(w));

  let score = 0;
  if (hasName)  score += 40;
  if (hasTrade) score += 30;
  if (hasLocal) score += 30;

  return {
    pass: score >= 75,
    score,
    detail: `name:${hasName} trade:${hasTrade} local:${hasLocal}`
  };
}

function evalNoAIMarkers(message) {
  const msg = message.toLowerCase();
  const found = AI_MARKERS.filter(m => msg.includes(m));
  return { pass: found.length === 0, found };
}

function evalNoBuzzwords(message) {
  const msg = message.toLowerCase();
  const found = BUZZWORDS.filter(w => msg.includes(w));
  return { pass: found.length === 0, found };
}

// Fix 2: added minimum word count (20)
function evalStructure(message) {
  const wordCount = message.trim().split(/\s+/).length;
  const endsWithQuestion = message.trim().endsWith('?');
  const sentences = message.trim().split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentencesBeforeQuestion = endsWithQuestion ? sentences.length - 1 : sentences.length;

  const tooShort = wordCount < 20;
  const tooLong  = wordCount > 80;

  return {
    pass: !tooShort && !tooLong && endsWithQuestion && sentencesBeforeQuestion <= 3,
    wordCount,
    endsWithQuestion,
    sentencesBeforeQuestion,
    tooShort,
    tooLong
  };
}

// Fix 3: spammy opener detection as Eval 5
function evalNoSpammyOpeners(message) {
  const msg = message.toLowerCase();
  const found = SPAMMY_OPENERS.filter(o => msg.startsWith(o) || msg.includes(o));
  return { pass: found.length === 0, found };
}

function runAllEvals(message, brief) {
  const p = evalPersonalization(message, brief);
  const a = evalNoAIMarkers(message);
  const b = evalNoBuzzwords(message);
  const s = evalStructure(message);
  const o = evalNoSpammyOpeners(message);

  return {
    personalization:    p,
    no_ai_markers:      a,
    no_buzzwords:       b,
    structure:          s,
    no_spammy_openers:  o,
    allPass: p.pass && a.pass && b.pass && s.pass && o.pass,
    failures: [
      !p.pass && `personalization score ${p.score}/100 (need 75) — ${p.detail}`,
      !a.pass && `AI markers found: ${a.found.join(', ')}`,
      !b.pass && `buzzwords found: ${b.found.join(', ')}`,
      !s.pass && `structure: ${s.wordCount} words (need 20–80), ends with ?:${s.endsWithQuestion}, sentences before question: ${s.sentencesBeforeQuestion}`,
      !o.pass && `spammy opener found: "${o.found[0]}"`
    ].filter(Boolean)
  };
}

// ── REWRITE PROMPT (Claude API) ───────────────────────────────────────────────

const REWRITE_SYSTEM = `You are an expert cold outreach copywriter. Rewrite the given cold message to fix the listed issues.

Rules you MUST follow:
- Between 20 and 80 words
- Ends with exactly one direct question (ends with "?")
- No more than 3 sentences before the question
- Must mention: business name, their trade (or a natural synonym for it), and a local signal (city or neighborhood)
- NO AI markers: "Certainly!", "As an AI", "I'd be happy to", "Great question", "Of course!", "Absolutely!", "I hope this message finds you well", "touch base", "circle back"
- NO buzzwords: "game-changing", "cutting-edge", "seamlessly", "leverage", "synergy", "revolutionize", "disruptive", "innovative solution", "next-level", "empower", "transformative", "streamline"
- NO spammy openers: "I noticed your business", "I came across your", "I'd love to help you grow", "I'm reaching out because", "Are you looking to grow", "I hope you don't mind"
- Sound like a real person — conversational, direct, not salesy
- Do NOT start with "Hi" or "Hello" followed by a comma

Respond with ONLY the rewritten message. No explanation, no quotes, no markdown.`;

async function rewrite(client, message, brief, failures, config) {
  const userContent = `Business: ${brief.business_name} (${brief.trade} in ${brief.city})
Hero angle: ${brief.hero_angle || 'n/a'}

Original message:
${message}

Issues to fix:
${failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Rewrite the message to fix all issues.`;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 300,
    system: [{ type: 'text', text: REWRITE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }]
  });

  return {
    message: response.content[0].text.trim(),
    usage:   response.usage
  };
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const entry = state.queue.find(l => l.lead_id === leadId);
  if (entry) {
    entry.status     = status;
    entry.checked_at = new Date().toISOString();
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nChecker starting');
  console.log('─'.repeat(50));

  const config = loadConfig();
  checkAutoRun(config);
  const effectiveLimit = checkLimits(config);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Add it to .env.local');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const briefs  = loadUncheckedBriefs();

  if (briefs.length === 0) {
    console.log('No unchecked briefs in /queue/. Run Diagnoser first.');
    process.exit(0);
  }

  const toProcess = briefs.slice(0, effectiveLimit);
  console.log(`Briefs to check: ${briefs.length} | Processing: ${toProcess.length}`);
  console.log(`Budget: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}\n`);

  let approved = 0, flagged = 0, rewritten = 0;
  let totalCost = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { file, data: brief } = toProcess[i];
    const filePath = path.join(QUEUE_DIR, file);
    const label = `[${i + 1}/${toProcess.length}] ${brief.business_name}`;

    let message      = brief.cold_message;
    let rewriteCount = 0;
    let runCost      = 0;

    // Template-based messages are pre-approved copy — only verify placeholders filled
    if (brief.template_based) {
      const hasUnfilled = /\[[A-Z]/.test(message);
      brief.final_message    = message;
      brief.checker_approved = !hasUnfilled;
      brief.checker_flag     = hasUnfilled ? 'unfilled_placeholder' : '';
      brief.rewrite_count    = 0;
      brief.checker_score    = { template_based: true, placeholders_filled: !hasUnfilled };
      brief.checked_at       = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(brief, null, 2));
      updateState(brief.lead_id, brief.checker_approved ? 'checked' : 'flagged');
      config.processed_today += 1;
      config.total_processed += 1;
      if (brief.checker_approved) {
        approved++;
        config.approved_total++;
        console.log(`${label} — ✓ template approved (${brief.template_id})`);
      } else {
        flagged++;
        config.flagged_total++;
        console.log(`${label} — ✗ unfilled placeholder in template ${brief.template_id}`);
      }
      saveConfig(config);
      continue;
    }

    let evals = runAllEvals(message, brief);

    // Rewrite loop — max 2 attempts
    while (!evals.allPass && rewriteCount < 2) {
      process.stdout.write(`${label} — fail (${evals.failures.length} issues), rewriting...`);
      try {
        const { message: newMsg, usage } = await rewrite(client, message, brief, evals.failures, config);
        const cost = calcCost(usage, config.rates);
        runCost += cost;
        totalCost += cost;
        config.spent_this_month = parseFloat((config.spent_this_month + cost).toFixed(6));
        saveConfig(config);

        message      = newMsg;
        rewriteCount++;
        evals        = runAllEvals(message, brief);
        console.log(` attempt ${rewriteCount} done ($${cost.toFixed(5)})`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.log(`\n  Rewrite error: ${err.message}`);
        break;
      }
    }

    // Write result back to brief file
    brief.final_message    = evals.allPass ? message : brief.cold_message;
    brief.checker_approved = evals.allPass;
    brief.checker_flag     = evals.allPass ? '' : 'human_review';
    brief.rewrite_count    = rewriteCount;
    brief.checker_score    = {
      personalization:   evals.personalization.score,
      no_ai_markers:     evals.no_ai_markers.pass,
      no_buzzwords:      evals.no_buzzwords.pass,
      structure:         evals.structure.pass,
      no_spammy_openers: evals.no_spammy_openers.pass
    };
    brief.checked_at = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(brief, null, 2));
    updateState(brief.lead_id, evals.allPass ? 'checked' : 'flagged');

    config.processed_today += 1;
    config.total_processed += 1;

    if (evals.allPass) {
      approved++;
      config.approved_total++;
      if (rewriteCount === 0) {
        console.log(`${label} — ✓ approved (no rewrites)`);
      } else {
        rewritten++;
        console.log(`${label} — ✓ approved after ${rewriteCount} rewrite(s) ($${runCost.toFixed(5)})`);
      }
    } else {
      flagged++;
      config.flagged_total++;
      console.log(`${label} — ✗ flagged for human review`);
      console.log(`   Issues: ${evals.failures.join(' | ')}`);
    }

    saveConfig(config);
    if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  config.last_run = new Date().toISOString();
  saveConfig(config);

  writeLog('checker', [
    `approved: ${approved} (${rewritten} rewritten)  flagged: ${flagged}`,
    `cost: $${totalCost.toFixed(5)}  monthly: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`
  ]);

  console.log('\n' + '─'.repeat(50));
  console.log('Done.');
  console.log(`  Approved:       ${approved} (${rewritten} needed rewrite)`);
  console.log(`  Flagged:        ${flagged} (need human review in /queue/)`);
  console.log(`  Cost this run:  $${totalCost.toFixed(5)}`);
  console.log(`  Monthly spend:  $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log('─'.repeat(50));

  if (flagged > 0) {
    console.log(`\nReview flagged briefs: grep -l '"checker_flag": "human_review"' queue/*.json`);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
