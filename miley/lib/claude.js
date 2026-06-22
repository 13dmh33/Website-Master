'use strict';

// Claude API wrapper
// handles auth, retry on transient failure, and enforces model/token settings
// all agents import this — never call Anthropic SDK directly

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Anthropic = require('@anthropic-ai/sdk');

const MODEL   = 'claude-sonnet-4-20250514';
const RETRY_DELAY_MS = 3000;

let _client = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Run node scripts/setup.js for guidance.');
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// sleep helper for retry backoff
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// make a Claude API call with one automatic retry on failure
// options: { prompt, systemPrompt, maxTokens }
// returns the text content of the first message block
async function call({ prompt, systemPrompt, maxTokens = 1000 }) {
  const client = getClient();

  const messages = [{ role: 'user', content: prompt }];
  const params = {
    model:      MODEL,
    max_tokens: maxTokens,
    messages,
  };
  if (systemPrompt) {
    params.system = systemPrompt;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.messages.create(params);
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return text;
    } catch (err) {
      if (attempt === 1) {
        console.warn(`Claude API call failed (attempt 1) — retrying in ${RETRY_DELAY_MS / 1000}s. Error: ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      } else {
        throw new Error(`Claude API call failed after 2 attempts: ${err.message}`);
      }
    }
  }
}

// parse JSON from a Claude response — strips markdown code fences if present
function parseJson(text) {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[claude] JSON parse failed. Raw (first 300 chars):', cleaned.slice(0, 300));
    throw new Error(`Claude response was not valid JSON: ${err.message}`);
  }
}

module.exports = { call, parseJson, MODEL };
