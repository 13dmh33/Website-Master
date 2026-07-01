import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runVisionPass } from '../lib/vision.js';

test('runVisionPass returns unavailable when there is no screenshot', async () => {
  const result = await runVisionPass(null, { anthropicClient: {} });
  assert.equal(result.available, false);
  assert.deepEqual(result.findings, []);
});

test('runVisionPass parses findings from a mocked Anthropic response', async () => {
  const mockClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify(['the layout is cluttered above the fold', 'stock photos do not match the trade']) }]
      })
    }
  };
  const result = await runVisionPass(Buffer.from('fake-image-bytes'), { anthropicClient: mockClient });
  assert.equal(result.available, true);
  assert.equal(result.findings.length, 2);
});

test('runVisionPass handles a malformed response gracefully', async () => {
  const mockClient = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'not json' }] })
    }
  };
  const result = await runVisionPass(Buffer.from('fake-image-bytes'), { anthropicClient: mockClient });
  assert.equal(result.available, false);
  assert.deepEqual(result.findings, []);
});
