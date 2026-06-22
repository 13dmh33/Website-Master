import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchPageSpeed, parsePageSpeedResponse } from '../lib/pagespeed.js';

test('fetchPageSpeed returns unavailable when no API key is configured', async () => {
  const result = await fetchPageSpeed('https://example.com', undefined);
  assert.equal(result.available, false);
});

test('fetchPageSpeed returns unavailable when the API responds with an error status', async () => {
  const mockFetch = async () => ({ ok: false, status: 429 });
  const result = await fetchPageSpeed('https://example.com', 'fake-key', mockFetch);
  assert.equal(result.available, false);
  assert.match(result.reason, /429/);
});

test('fetchPageSpeed parses a successful mocked response', async () => {
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      lighthouseResult: {
        categories: { performance: { score: 0.42 } },
        audits: {
          'largest-contentful-paint': { numericValue: 4200 },
          'cumulative-layout-shift': { numericValue: 0.3 },
          viewport: { score: 1 }
        }
      }
    })
  });
  const result = await fetchPageSpeed('https://example.com', 'fake-key', mockFetch);
  assert.equal(result.available, true);
  assert.equal(result.performance_score, 42);
  assert.equal(result.is_slow, true);
  assert.equal(result.is_mobile_friendly, true);
});

test('parsePageSpeedResponse returns unavailable when performance score is missing', () => {
  const result = parsePageSpeedResponse({ lighthouseResult: { categories: {} } });
  assert.equal(result.available, false);
});
