/**
 * Nora config schema — validates a per-customer config object.
 *
 * Fails loud: validateConfig() throws on anything malformed. There is no
 * silent-repair or default-filling path here — a bad config must never
 * quietly become a different config. Callers that want defaults apply them
 * before calling validateConfig(), not after.
 */

'use strict';

const KNOWN_CHANNELS = ['missed_call', 'sms', 'web_chat', 'meta_dm'];
const AFTER_HOURS_BEHAVIORS = ['capture_and_promise', 'book_anyway'];
const ESCALATION_TRIGGERS = ['emergency', 'angry_customer', 'high_value', 'repeat_no_answer', 'explicit_request'];

function fail(customerLabel, message) {
  throw new Error(`Invalid Nora config${customerLabel ? ` (${customerLabel})` : ''}: ${message}`);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateOffering(offering, index, customerLabel) {
  const where = `offerings[${index}]`;
  if (!offering || typeof offering !== 'object') {
    fail(customerLabel, `${where} must be an object`);
  }
  if (!isNonEmptyString(offering.id)) {
    fail(customerLabel, `${where}.id is required and must be a non-empty string`);
  }
  if (!isNonEmptyString(offering.label)) {
    fail(customerLabel, `${where}.label is required and must be a non-empty string`);
  }
  if (!Array.isArray(offering.qualifyQs) || offering.qualifyQs.length === 0) {
    fail(customerLabel, `${where}.qualifyQs must be a non-empty array`);
  }
  offering.qualifyQs.forEach((q, qi) => {
    if (!isNonEmptyString(q)) {
      fail(customerLabel, `${where}.qualifyQs[${qi}] must be a non-empty string`);
    }
  });
  if (!isNonEmptyString(offering.bookingType)) {
    fail(customerLabel, `${where}.bookingType is required and must be a non-empty string`);
  }
  if (!isNonEmptyString(offering.calendarId)) {
    fail(customerLabel, `${where}.calendarId is required and must be a non-empty string`);
  }
}

function validateBusinessHours(businessHours, customerLabel) {
  if (!businessHours || typeof businessHours !== 'object') {
    fail(customerLabel, 'businessHours is required and must be an object');
  }
  if (!isNonEmptyString(businessHours.timezone)) {
    fail(customerLabel, 'businessHours.timezone is required (IANA tz name, e.g. "America/Denver")');
  }
  if (!businessHours.days || typeof businessHours.days !== 'object') {
    fail(customerLabel, 'businessHours.days is required and must be an object keyed by mon..sun');
  }
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  for (const day of DAYS) {
    const val = businessHours.days[day];
    if (val === null || val === undefined) continue; // closed that day
    if (!Array.isArray(val) || val.length !== 2 || !isNonEmptyString(val[0]) || !isNonEmptyString(val[1])) {
      fail(customerLabel, `businessHours.days.${day} must be null (closed) or a [open, close] pair of "HH:MM" strings`);
    }
  }
}

function validateEscalation(escalation, customerLabel) {
  if (!escalation || typeof escalation !== 'object') {
    fail(customerLabel, 'escalation is required and must be an object');
  }
  if (!isNonEmptyString(escalation.toPhone) && !isNonEmptyString(escalation.toEmail)) {
    fail(customerLabel, 'escalation must set at least one of toPhone or toEmail');
  }
  if (!Array.isArray(escalation.triggers) || escalation.triggers.length === 0) {
    fail(customerLabel, 'escalation.triggers must be a non-empty array');
  }
  escalation.triggers.forEach((t, ti) => {
    if (!ESCALATION_TRIGGERS.includes(t)) {
      fail(customerLabel, `escalation.triggers[${ti}] "${t}" is not a known trigger (expected one of: ${ESCALATION_TRIGGERS.join(', ')})`);
    }
  });
}

/**
 * Validates a Nora customer config. Throws on any malformed field.
 * Returns the same object (not a copy) on success, for convenient chaining.
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    fail(null, 'config must be an object');
  }
  const customerLabel = isNonEmptyString(config.customerId) ? config.customerId : null;

  if (!isNonEmptyString(config.customerId)) {
    fail(customerLabel, 'customerId is required and must be a non-empty string');
  }

  if (!Array.isArray(config.enabledChannels) || config.enabledChannels.length === 0) {
    fail(customerLabel, 'enabledChannels must be a non-empty array');
  }
  config.enabledChannels.forEach((ch, i) => {
    if (!KNOWN_CHANNELS.includes(ch)) {
      fail(customerLabel, `enabledChannels[${i}] "${ch}" is not a known channel (expected one of: ${KNOWN_CHANNELS.join(', ')})`);
    }
  });

  if (!Array.isArray(config.offerings) || config.offerings.length === 0) {
    fail(customerLabel, 'offerings must be a non-empty array');
  }
  config.offerings.forEach((o, i) => validateOffering(o, i, customerLabel));
  const ids = config.offerings.map(o => o.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    fail(customerLabel, `offerings ids must be unique — duplicated: ${[...new Set(dupes)].join(', ')}`);
  }

  validateBusinessHours(config.businessHours, customerLabel);

  if (!AFTER_HOURS_BEHAVIORS.includes(config.afterHoursBehavior)) {
    fail(customerLabel, `afterHoursBehavior "${config.afterHoursBehavior}" is not valid (expected one of: ${AFTER_HOURS_BEHAVIORS.join(', ')})`);
  }

  validateEscalation(config.escalation, customerLabel);

  return config;
}

module.exports = {
  validateConfig,
  KNOWN_CHANNELS,
  AFTER_HOURS_BEHAVIORS,
  ESCALATION_TRIGGERS,
};
