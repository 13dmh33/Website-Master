'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sentiment = require('../lib/sentiment');

test('classifyComments returns [] for an empty/missing comment list', async () => {
  assert.deepEqual(await sentiment.classifyComments([]), []);
  assert.deepEqual(await sentiment.classifyComments(null), []);
});

test('summarize aggregates sentiment and reason counts', () => {
  const classified = [
    { text: 'a', sentiment: 'positive', reason: 'interest_in_service' },
    { text: 'b', sentiment: 'positive', reason: 'interest_in_service' },
    { text: 'c', sentiment: 'negative', reason: 'skepticism' },
    { text: 'd', sentiment: 'neutral',  reason: 'other' },
  ];
  const summary = sentiment.summarize(classified);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.bySentiment, { positive: 2, negative: 1, neutral: 1 });
  assert.equal(summary.byReason.interest_in_service, 2);
  assert.equal(summary.byReason.skepticism, 1);
});
