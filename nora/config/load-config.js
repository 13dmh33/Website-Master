/**
 * Nora config loader — reads a per-customer config JSON file and validates it.
 *
 * Fails loud: a missing file, malformed JSON, or a config that fails
 * validateConfig() all throw. Never returns a partially-loaded or
 * default-patched config silently.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./schema');

const CUSTOMERS_DIR = path.join(__dirname, 'customers');

function customerConfigPath(customerId) {
  return path.join(CUSTOMERS_DIR, `${customerId}.json`);
}

/**
 * Loads and validates the config for a given customerId.
 * Throws if the file doesn't exist, isn't valid JSON, or fails schema validation.
 */
function loadConfig(customerId) {
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    throw new Error('loadConfig requires a non-empty customerId');
  }
  const filePath = customerConfigPath(customerId);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No Nora config found for customerId "${customerId}" (expected ${filePath})`);
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read Nora config for "${customerId}": ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Nora config for "${customerId}" is not valid JSON: ${err.message}`);
  }

  if (config.customerId !== customerId) {
    throw new Error(
      `Nora config file customers/${customerId}.json has customerId "${config.customerId}" ` +
      `— filename must match the customerId field exactly`
    );
  }

  return validateConfig(config);
}

/** Loads and validates every config in nora/config/customers/. Throws on the first invalid one. */
function loadAllConfigs() {
  if (!fs.existsSync(CUSTOMERS_DIR)) return [];
  const files = fs.readdirSync(CUSTOMERS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => loadConfig(f.replace(/\.json$/, '')));
}

module.exports = { loadConfig, loadAllConfigs, customerConfigPath, CUSTOMERS_DIR };
