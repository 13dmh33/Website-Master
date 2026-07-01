import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getDomainType,
  detectPlatform,
  checkSsl,
  checkTapToCall,
  checkContactForm,
  checkStructuredData,
  checkStaleness
} from '../lib/htmlChecks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');

test('getDomainType flags wix builder subdomain', () => {
  const result = getDomainType('https://joesplumbing.wixsite.com/home');
  assert.equal(result.domain_type, 'builder_subdomain');
  assert.equal(result.builder_subdomain_platform, 'wix');
});

test('getDomainType treats a custom domain as custom_domain', () => {
  const result = getDomainType('https://summitelectrical.com');
  assert.equal(result.domain_type, 'custom_domain');
  assert.equal(result.builder_subdomain_platform, null);
});

test('detectPlatform finds wix from HTML signature', () => {
  const html = fixture('diy-wix.html');
  assert.equal(detectPlatform(html, 'https://joesplumbing.com'), 'wix');
});

test('detectPlatform finds wordpress from HTML signature', () => {
  const html = fixture('pro-wordpress.html');
  assert.equal(detectPlatform(html, 'https://summitelectrical.com'), 'wordpress');
});

test('detectPlatform falls back to custom when no signature matches', () => {
  const html = fixture('ambiguous.html');
  assert.equal(detectPlatform(html, 'https://generichandyman.com'), 'custom');
});

test('checkSsl passes for https urls', () => {
  assert.equal(checkSsl('https://example.com').ssl_valid, true);
});

test('checkSsl fails for http urls', () => {
  assert.equal(checkSsl('http://example.com').ssl_valid, false);
});

test('checkTapToCall detects a tel: link', () => {
  const html = fixture('diy-wix.html');
  assert.equal(checkTapToCall(html).has_tap_to_call, true);
});

test('checkTapToCall returns false when no tel: link present', () => {
  const html = fixture('ambiguous.html');
  assert.equal(checkTapToCall(html).has_tap_to_call, false);
});

test('checkContactForm detects a form element', () => {
  const html = fixture('pro-wordpress.html');
  assert.equal(checkContactForm(html).has_contact_form, true);
});

test('checkContactForm returns false when no form present', () => {
  const html = fixture('diy-wix.html');
  assert.equal(checkContactForm(html).has_contact_form, false);
});

test('checkStructuredData detects JSON-LD and local business schema', () => {
  const html = fixture('pro-wordpress.html');
  const result = checkStructuredData(html);
  assert.equal(result.has_structured_data, true);
});

test('checkStructuredData returns false when no JSON-LD present', () => {
  const html = fixture('diy-wix.html');
  assert.equal(checkStructuredData(html).has_structured_data, false);
});

test('checkStaleness flags an old copyright year as stale', () => {
  const html = fixture('diy-wix.html');
  const result = checkStaleness(html);
  assert.equal(result.footer_copyright_year, 2017);
  assert.equal(result.stale_signal, true);
});

test('checkStaleness does not flag a recent copyright year', () => {
  const html = fixture('pro-wordpress.html');
  const result = checkStaleness(html);
  assert.equal(result.footer_copyright_year, 2024);
  assert.equal(result.stale_signal, false);
});

test('checkStaleness returns null when no copyright year present', () => {
  const html = fixture('ambiguous.html');
  const result = checkStaleness(html);
  assert.equal(result.footer_copyright_year, null);
  assert.equal(result.stale_signal, false);
});
