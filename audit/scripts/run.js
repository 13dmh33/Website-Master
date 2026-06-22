#!/usr/bin/env node
// Orchestrator — reads leads.csv, runs Modules 1-4 per lead, writes draft outputs to /audit/output.
// Never sends anything. A failure on one lead is logged and the run continues.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

import { runDeterministicChecks } from '../lib/htmlChecks.js';
import { fetchPageSpeed } from '../lib/pagespeed.js';
import { classifyLead } from '../lib/classifier.js';
import { captureScreenshot } from '../lib/screenshot.js';
import { runVisionPass } from '../lib/vision.js';
import { composeOutputs } from '../lib/compose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_ROOT = path.join(__dirname, '..');
const INPUT_PATH = path.join(AUDIT_ROOT, 'input', 'leads.csv');
const OUTPUT_DIR = path.join(AUDIT_ROOT, 'output');

dotenv.config({ path: path.join(AUDIT_ROOT, '.env') });

function slugify(businessName) {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function fetchHtml(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();
  return { html, headers: Object.fromEntries(res.headers.entries()) };
}

async function processLead(lead, { anthropicClient, signatureName, pagespeedApiKey, model }) {
  const slug = slugify(lead.business_name);

  const { html } = await fetchHtml(lead.url);
  const deterministicFindings = runDeterministicChecks({ html, url: lead.url });
  const pagespeed = await fetchPageSpeed(lead.url, pagespeedApiKey);
  const findings = { ...deterministicFindings, pagespeed };

  const bucket = classifyLead(deterministicFindings);

  const screenshot = await captureScreenshot(lead.url);
  const vision = await runVisionPass(screenshot.buffer, { anthropicClient, model });

  const composed = await composeOutputs({
    lead,
    findings,
    bucket,
    visionFindings: vision.findings,
    anthropicClient,
    model,
    signatureName
  });

  const record = {
    lead,
    findings,
    vision,
    bucket,
    output_paths: {
      json: `output/${slug}.json`,
      email: `output/${slug}.email.txt`,
      mini_audit: `output/${slug}.mini-audit.md`
    }
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.email.txt`), composed.email_hook);
  fs.writeFileSync(path.join(OUTPUT_DIR, `${slug}.mini-audit.md`), composed.mini_audit_markdown);

  return {
    business_name: lead.business_name,
    slug,
    bucket: bucket.bucket,
    confidence: bucket.confidence,
    top_finding: vision.findings[0] || deterministicFindings.stale_reason || null,
    output_paths: record.output_paths
  };
}

async function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    console.error(`No input file found at ${INPUT_PATH}`);
    process.exit(1);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const signatureName = process.env.TREVO_SIGNATURE_NAME;
  if (!signatureName) {
    console.error('TREVO_SIGNATURE_NAME is required (see .env.example). Aborting.');
    process.exit(1);
  }

  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const pagespeedApiKey = process.env.PAGESPEED_API_KEY;

  const csvContent = fs.readFileSync(INPUT_PATH, 'utf-8');
  const leads = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

  const summary = [];
  for (const lead of leads) {
    process.stdout.write(`Auditing ${lead.business_name} (${lead.url})... `);
    try {
      const result = await processLead(lead, { anthropicClient, signatureName, pagespeedApiKey, model });
      summary.push({ ...result, status: 'ok' });
      console.log(`done — bucket: ${result.bucket} (${result.confidence})`);
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      summary.push({ business_name: lead.business_name, status: 'failed', error: err.message });
    }
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.json'), JSON.stringify(summary, null, 2));
  console.log(`\nRun summary written to ${path.join(OUTPUT_DIR, 'index.json')}`);
}

main();
