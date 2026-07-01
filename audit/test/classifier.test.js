import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyLead } from '../lib/classifier.js';

test('classifyLead returns diy-builder with high confidence for a builder subdomain', () => {
  const result = classifyLead({ domain_type: 'builder_subdomain', platform: 'wix' });
  assert.equal(result.bucket, 'diy-builder');
  assert.equal(result.confidence, 'high');
});

test('classifyLead returns diy-builder with medium confidence for a custom domain on a consumer builder', () => {
  const result = classifyLead({ domain_type: 'custom_domain', platform: 'squarespace' });
  assert.equal(result.bucket, 'diy-builder');
  assert.equal(result.confidence, 'medium');
});

test('classifyLead returns pro-maintained with high confidence for WordPress on a custom domain', () => {
  const result = classifyLead({ domain_type: 'custom_domain', platform: 'wordpress' });
  assert.equal(result.bucket, 'pro-maintained');
  assert.equal(result.confidence, 'high');
});

test('classifyLead returns pro-maintained with medium confidence for an unrecognized custom build', () => {
  const result = classifyLead({ domain_type: 'custom_domain', platform: 'custom' });
  assert.equal(result.bucket, 'pro-maintained');
  assert.equal(result.confidence, 'medium');
});

test('classifyLead returns unknown with low confidence when signals are missing entirely', () => {
  const result = classifyLead({ domain_type: undefined, platform: undefined });
  assert.equal(result.bucket, 'unknown');
  assert.equal(result.confidence, 'low');
});
