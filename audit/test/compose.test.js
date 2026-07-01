import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeOutputs } from '../lib/compose.js';

const baseArgs = {
  lead: { business_name: 'Acme Test Plumbing', trade: 'plumbing', city: 'Faketown CO', url: 'https://example.com' },
  findings: { platform: 'wix', domain_type: 'builder_subdomain' },
  bucket: { bucket: 'diy-builder', confidence: 'high', reason: 'builder subdomain on wix' },
  visionFindings: ['the layout feels dated'],
  signatureName: 'Dave'
};

function clientReturning(json) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) } };
}

test('composeOutputs throws without a signature name', async () => {
  await assert.rejects(
    () => composeOutputs({ ...baseArgs, signatureName: undefined, anthropicClient: clientReturning({ email_hook: 'x', mini_audit_markdown: 'y' }) }),
    /TREVO_SIGNATURE_NAME/
  );
});

test('composeOutputs returns clean copy unchanged', async () => {
  const clean = {
    email_hook: 'Your homepage still shows a 2017 copyright in the footer, which is the kind of detail homeowners notice. Worth a second look. Dave',
    mini_audit_markdown: '## a quick look at your site\n\nDave'
  };
  const result = await composeOutputs({ ...baseArgs, anthropicClient: clientReturning(clean) });
  assert.equal(result.email_hook, clean.email_hook);
});

test('composeOutputs rejects copy that fails the brand-voice linter', async () => {
  const dirty = {
    email_hook: 'Nora is a bot that will save the day! 🎉',
    mini_audit_markdown: '## Your Website Needs Help\n\nDave'
  };
  await assert.rejects(
    () => composeOutputs({ ...baseArgs, anthropicClient: clientReturning(dirty) }),
/failed brand-voice lint/
  );
});
