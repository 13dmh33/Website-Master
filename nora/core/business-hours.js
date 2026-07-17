/**
 * Business hours check — is a given timestamp inside a customer's configured
 * open hours, in their configured timezone.
 *
 * Deliberately simple: no overnight-crossing hours (e.g. "22:00"-"02:00")
 * support in this session — every offering seen so far closes same-day.
 * Document that limitation rather than half-build it.
 */

'use strict';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function localDayAndTime(timezone, isoTimestamp) {
  const date = new Date(isoTimestamp);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
  let hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  if (hour === '24') hour = '00'; // Intl midnight quirk
  return { weekday, hm: `${hour}:${minute}` };
}

/** True if isoTimestamp falls within businessHours for its configured timezone. */
function isWithinBusinessHours(businessHours, isoTimestamp) {
  const { weekday, hm } = localDayAndTime(businessHours.timezone, isoTimestamp);
  const range = businessHours.days[weekday];
  if (!range) return false; // closed that day
  const [open, close] = range;
  return hm >= open && hm < close;
}

module.exports = { isWithinBusinessHours, localDayAndTime, DAY_KEYS };
