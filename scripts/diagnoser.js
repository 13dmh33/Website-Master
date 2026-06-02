#!/usr/bin/env node
/**
 * Diagnoser — generates briefs + cold messages for scouted leads via Claude API
 *
 * Usage:
 *   node scripts/diagnoser.js --force
 *   node scripts/diagnoser.js --limit 10 --force
 *
 * Reads:  leads/*.json           (Scout output)
 *         state.json             (finds leads with status = 'scouted')
 *         config/diagnoser-config.json
 *         .env.local             (ANTHROPIC_API_KEY)
 * Writes: queue/{lead_id}-brief.json
 *         state.json             (status: scouted → diagnosed)
 *         config/diagnoser-config.json (spend + daily count)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { writeLog }        = require('./logger');
const { pickAndFill }     = require('./template-picker');
const { recordAnthropic } = require('./cost-tracker');

// ── PATHS ─────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'diagnoser-config.json');
const STATE_PATH  = path.join(ROOT, 'state.json');
const LEADS_DIR   = path.join(ROOT, 'leads');
const QUEUE_DIR   = path.join(ROOT, 'queue');

// ── ARG PARSING ───────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (flag) => args.includes(flag);
const limitArg = parseInt(getArg('--limit') || '0', 10);

// ── CONFIG ────────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaults = {
      daily_limit: 30,
      monthly_cap: 5.00,
      auto_run: false,
      model: 'claude-haiku-4-5-20251001',
      // Token rates for cost tracking — verify at console.anthropic.com/pricing
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
    console.log('Diagnoser is in manual mode (auto_run = false).');
    console.log('Run with --force to execute, or set auto_run = true in config/diagnoser-config.json.');
    process.exit(0);
  }
}

function checkLimits(config) {
  // Reset daily counter on new day
  if (config.today !== today()) {
    config.today = today();
    config.processed_today = 0;
  }

  // Reset monthly spend on new month
  if (config.current_month !== currentMonth()) {
    config.current_month = currentMonth();
    config.spent_this_month = 0;
    console.log('New month — spend counter reset to $0.00');
  }

  const dailyRemaining  = config.daily_limit - config.processed_today;
  const budgetRemaining = config.monthly_cap - config.spent_this_month;

  if (dailyRemaining <= 0) {
    console.error(`DAILY LIMIT REACHED: ${config.processed_today} / ${config.daily_limit} leads processed today.`);
    console.error('Wait until tomorrow or raise daily_limit in config/diagnoser-config.json.');
    process.exit(1);
  }

  if (budgetRemaining <= 0) {
    console.error(`MONTHLY BUDGET REACHED: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)} used.`);
    console.error('Wait until next month or raise monthly_cap in config/diagnoser-config.json.');
    process.exit(1);
  }

  // Effective limit = most restrictive of: daily remaining, --limit flag, budget estimate
  const estimatedCostPerLead = 0.001;
  const budgetLeads = Math.floor(budgetRemaining / estimatedCostPerLead);
  let effective = Math.min(dailyRemaining, budgetLeads);
  if (limitArg > 0) effective = Math.min(effective, limitArg);

  return effective;
}

function calcCost(usage, rates) {
  const inputCost       = (usage.input_tokens || 0)                / 1_000_000 * rates.input_per_mtok;
  const outputCost      = (usage.output_tokens || 0)               / 1_000_000 * rates.output_per_mtok;
  const cacheWriteCost  = (usage.cache_creation_input_tokens || 0) / 1_000_000 * rates.cache_write_per_mtok;
  const cacheReadCost   = (usage.cache_read_input_tokens || 0)     / 1_000_000 * rates.cache_read_per_mtok;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── LEAD LOADING ──────────────────────────────────────────────────────────────

function loadScoutedLeads() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

  // Find lead IDs that are still in 'scouted' status
  const scoutedIds = new Set(
    state.queue
      .filter(l => l.status === 'scouted')
      .map(l => l.lead_id)
  );

  if (scoutedIds.size === 0) return [];

  // Read all leads files and collect matching leads
  const leads = [];
  const files = fs.readdirSync(LEADS_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(LEADS_DIR, file);
    try {
      const batch = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const lead of batch) {
        if (scoutedIds.has(lead.lead_id)) {
          leads.push(lead);
        }
      }
    } catch (e) {
      console.warn(`Could not read ${file}: ${e.message}`);
    }
  }

  // Sort by gap_score descending so we process best leads first
  return leads.sort((a, b) => b.gap_score - a.gap_score);
}

// ── CLAUDE API ────────────────────────────────────────────────────────────────

// System prompt is cached — only billed once per session, then cheap reads
const SYSTEM_PROMPT = `You are an expert sales researcher for a web agency targeting home service contractors.

Given a lead (a contractor with a weak or missing website), produce a structured JSON brief for internal use.
The cold message copy is handled separately — do NOT write one here.

Rules:
- diagnosis: max 60 words, specific about their actual gaps (review count, no website, outdated site, etc.)
- hero_angle: 1 sentence, their strongest differentiator based on the data
- tone: one of: warm | direct | urgent | professional
  - warm = family business, long-established, community feel
  - direct = trades, no-nonsense, time = money
  - urgent = they're losing jobs to competitors right now
  - professional = general contractors, remodelers
- gap_score: integer 1-10 (your own assessment — may differ slightly from the input score)
- channel: copy exactly from the input — do not change it

Respond ONLY with a valid JSON object with keys: diagnosis, hero_angle, tone, gap_score, channel. No markdown, no explanation.`;

async function generateBrief(client, lead) {
  const userContent = `Generate a brief for this lead:

${JSON.stringify(lead, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      { role: 'user', content: userContent }
    ]
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if Claude wraps in ```json ... ```
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

  let brief;
  try {
    brief = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${raw}`);
  }

  return { brief, usage: response.usage };
}

// ── STATE UPDATE ──────────────────────────────────────────────────────────────

function updateState(leadId, status) {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const entry = state.queue.find(l => l.lead_id === leadId);
  if (entry) {
    entry.status = status;
    entry.diagnosed_at = new Date().toISOString();
  }
  state.daily_stats.briefs_written = (state.daily_stats.briefs_written || 0) + 1;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function markTopPriority(briefs) {
  // After all briefs are written, re-read and set priority on top 5 by gap_score
  const scored = briefs
    .map(b => ({ lead_id: b.lead_id, gap_score: b.gap_score }))
    .sort((a, b) => b.gap_score - a.gap_score)
    .slice(0, 5)
    .map(b => b.lead_id);

  const prioritySet = new Set(scored);

  for (const b of briefs) {
    const filePath = path.join(QUEUE_DIR, `${b.lead_id}-brief.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data.priority = prioritySet.has(b.lead_id);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
  }

  return scored;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDiagnoser starting');
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

  const leads = loadScoutedLeads();
  if (leads.length === 0) {
    console.log('No scouted leads to process. Run Scout first.');
    process.exit(0);
  }

  const toProcess = leads.slice(0, effectiveLimit);
  console.log(`Leads available: ${leads.length} | Processing: ${toProcess.length} | Daily limit: ${config.daily_limit}`);
  console.log(`Budget: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)} used this month\n`);

  const processedBriefs = [];
  let totalCost = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const lead = toProcess[i];
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${lead.business_name} (${lead.city})... `);

    try {
      const { brief, usage } = await generateBrief(client, lead);
      const cost = calcCost(usage, config.rates);
      recordAnthropic(cost, 'diagnoser', usage);

      // Email-first: if lead has email use it; if phone-only fall back to sms; else keep Scout's assignment
      const channel = lead.email ? 'email' : (lead.phone ? 'sms' : lead.channel);
      const tmpl     = pickAndFill(channel, { ...lead, ...brief });

      // Secondary channel: if lead has both email AND phone, also prepare SMS
      const secondaryChannel = (lead.email && lead.phone) ? 'sms' : null;
      const secTmpl = secondaryChannel ? pickAndFill(secondaryChannel, { ...lead, ...brief }) : null;

      const coldMsg  = tmpl?.message       || '';
      const tmplId   = tmpl?.template_id   || null;
      const tmplName = tmpl?.template_name || null;

      if (!tmpl) {
        console.log(`\n  ⚠  No template available for ${lead.business_name} (${channel}) — brief saved without cold_message`);
      }
      if (secondaryChannel && !secTmpl) {
        console.log(`\n  ⚠  No SMS template available for ${lead.business_name} — secondary channel skipped`);
      }

      const fullBrief = {
        lead_id:          lead.lead_id,
        business_name:    lead.business_name,
        trade:            lead.trade,
        city:             lead.city,
        phone:            lead.phone,
        email:            lead.email || '',
        website:          lead.website,
        review_count:     lead.review_count,
        rating:           lead.rating,
        diagnosis:        brief.diagnosis  || '',
        hero_angle:       brief.hero_angle || '',
        tone:             brief.tone       || 'direct',
        cold_message:            coldMsg,
        template_id:             tmplId,
        template_name:           tmplName,
        template_based:          !!tmpl,
        gap_score:               brief.gap_score  || lead.gap_score,
        priority:                false,
        channel:                 channel,
        secondary_channel:       secondaryChannel,
        secondary_message:       secTmpl?.message || null,
        secondary_template_id:   secTmpl?.template_id || null,
        secondary_template_name: secTmpl?.template_name || null,
        checker_approved:        false,
        diagnosed_at:            new Date().toISOString()
      };

      const outPath = path.join(QUEUE_DIR, `${lead.lead_id}-brief.json`);
      fs.writeFileSync(outPath, JSON.stringify(fullBrief, null, 2));

      updateState(lead.lead_id, 'diagnosed');
      processedBriefs.push(fullBrief);

      totalCost += cost;
      config.spent_this_month = parseFloat((config.spent_this_month + cost).toFixed(6));
      config.processed_today  += 1;
      config.total_processed  += 1;
      saveConfig(config);

      console.log(`done ($${cost.toFixed(5)})`);

      // Small delay to stay within API rate limits
      if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      errors++;
    }
  }

  // Set priority flag on top 5 briefs
  const priorityIds = markTopPriority(processedBriefs);

  config.last_run = new Date().toISOString();
  saveConfig(config);

  writeLog('diagnoser', [
    `processed: ${processedBriefs.length}  errors: ${errors}`,
    `priority leads: ${priorityIds.join(', ') || 'none'}`,
    `cost: $${totalCost.toFixed(5)}  monthly: $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`
  ]);

  console.log('\n' + '─'.repeat(50));
  console.log(`Done.`);
  console.log(`  Processed:      ${processedBriefs.length} leads`);
  console.log(`  Errors:         ${errors}`);
  console.log(`  Priority (top5): ${priorityIds.join(', ') || 'none'}`);
  console.log(`  Cost this run:  $${totalCost.toFixed(5)}`);
  console.log(`  Monthly spend:  $${config.spent_this_month.toFixed(4)} / $${config.monthly_cap.toFixed(2)}`);
  console.log(`  Briefs in /queue/: ${processedBriefs.length} new files`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
