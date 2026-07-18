'use strict';
/**
 * Loads and validates a proposal input from proposals/inputs/<leadId>.json.
 * Fails loud on a missing file, malformed JSON, or a schema violation.
 */

const fs = require('fs');
const path = require('path');
const { validateProposalInput } = require('./schema');

const INPUTS_DIR = path.join(__dirname, '..', '..', '..', 'proposals', 'inputs');

function inputPath(leadId) {
  return path.join(INPUTS_DIR, `${leadId}.json`);
}

function loadProposalInput(leadId) {
  if (typeof leadId !== 'string' || leadId.trim().length === 0) {
    throw new Error('loadProposalInput requires a non-empty leadId');
  }
  const filePath = inputPath(leadId);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `No proposal input found for lead "${leadId}" (expected ${filePath}). ` +
      `Create it manually — see proposals/inputs/README.md for the shape — until a ` +
      `call-notes source exists (Nora isn't merged onto this branch; see STATE-AUDIT.md).`
    );
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read proposal input for "${leadId}": ${err.message}`);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Proposal input for "${leadId}" is not valid JSON: ${err.message}`);
  }

  if (input.leadId !== leadId) {
    throw new Error(
      `proposals/inputs/${leadId}.json has leadId "${input.leadId}" — filename must match the leadId field exactly`
    );
  }

  return validateProposalInput(input);
}

module.exports = { loadProposalInput, inputPath, INPUTS_DIR };
