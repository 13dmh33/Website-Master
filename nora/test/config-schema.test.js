'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../config/schema');
const { loadConfig, loadAllConfigs } = require('../config/load-config');

function validBase() {
  return {
    customerId: 'test-customer',
    enabledChannels: ['missed_call', 'sms'],
    offerings: [{
      id: 'plumbing',
      label: 'Plumbing',
      qualifyQs: ['What is the issue?'],
      bookingType: 'onsite_estimate',
      calendarId: 'cal_1',
    }],
    businessHours: {
      timezone: 'America/Denver',
      days: { mon: ['08:00', '17:00'], tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    },
    afterHoursBehavior: 'capture_and_promise',
    escalation: { toPhone: '+17205550100', toEmail: '', triggers: ['emergency'] },
  };
}

test('validateConfig — accepts a well-formed single-offering config', () => {
  assert.doesNotThrow(() => validateConfig(validBase()));
});

test('validateConfig — throws on missing customerId', () => {
  const cfg = validBase();
  delete cfg.customerId;
  assert.throws(() => validateConfig(cfg), /customerId is required/);
});

test('validateConfig — throws on unknown channel', () => {
  const cfg = validBase();
  cfg.enabledChannels = ['carrier_pigeon'];
  assert.throws(() => validateConfig(cfg), /not a known channel/);
});

test('validateConfig — throws on empty offerings', () => {
  const cfg = validBase();
  cfg.offerings = [];
  assert.throws(() => validateConfig(cfg), /offerings must be a non-empty array/);
});

test('validateConfig — throws on duplicate offering ids', () => {
  const cfg = validBase();
  cfg.offerings.push({ ...cfg.offerings[0] });
  assert.throws(() => validateConfig(cfg), /offerings ids must be unique/);
});

test('validateConfig — throws on offering missing qualifyQs', () => {
  const cfg = validBase();
  delete cfg.offerings[0].qualifyQs;
  assert.throws(() => validateConfig(cfg), /qualifyQs must be a non-empty array/);
});

test('validateConfig — throws on invalid afterHoursBehavior', () => {
  const cfg = validBase();
  cfg.afterHoursBehavior = 'ignore_forever';
  assert.throws(() => validateConfig(cfg), /afterHoursBehavior/);
});

test('validateConfig — throws on escalation with no phone or email', () => {
  const cfg = validBase();
  cfg.escalation = { toPhone: '', toEmail: '', triggers: ['emergency'] };
  assert.throws(() => validateConfig(cfg), /at least one of toPhone or toEmail/);
});

test('validateConfig — throws on unknown escalation trigger', () => {
  const cfg = validBase();
  cfg.escalation.triggers = ['made_up_trigger'];
  assert.throws(() => validateConfig(cfg), /not a known trigger/);
});

test('validateConfig — throws on malformed business hours day', () => {
  const cfg = validBase();
  cfg.businessHours.days.mon = ['08:00'];
  assert.throws(() => validateConfig(cfg), /businessHours\.days\.mon/);
});

test('loadConfig — loads and validates the example single-offering plumber config', () => {
  const cfg = loadConfig('example-plumber-single');
  assert.equal(cfg.customerId, 'example-plumber-single');
  assert.equal(cfg.offerings.length, 1);
});

test('loadConfig — loads and validates the example two-offering plumbing+HVAC config', () => {
  const cfg = loadConfig('example-plumbing-hvac-two-offering');
  assert.equal(cfg.customerId, 'example-plumbing-hvac-two-offering');
  assert.equal(cfg.offerings.length, 2);
  assert.deepEqual(cfg.offerings.map(o => o.id), ['plumbing', 'hvac']);
});

test('loadConfig — throws on unknown customerId', () => {
  assert.throws(() => loadConfig('does-not-exist'), /No Nora config found/);
});

test('loadAllConfigs — loads every config in customers/ without throwing', () => {
  const configs = loadAllConfigs();
  assert.ok(configs.length >= 2);
});
