'use strict';

// calendar.js — evaluates templates/calendar.json against a given week.
//
// Only called from lib/planner.js's base/september branch — October is fully
// owned by october-campaign.json and never reaches this module (see
// calendar.json's _purpose note). Returns the calendar entries whose rule
// matches ANY day in the Mon-Sun week containing `date`.

const store = require('./store');

const WEEKDAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
const DAY_ABBR = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

// Monday (00:00) of the week containing `date`
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Monday of the week AFTER the week containing `date` — i.e. the week posts
// actually land in when content is generated in advance (Thu → following
// week, per scheduler.js's nextWeekOccurrence). Pass this (not `new Date()`)
// to buildWeekPlan when generating ahead, so calendar/month checks match the
// week that will actually be posted.
function nextWeekDate(date = new Date()) {
  const monday = mondayOf(date);
  monday.setDate(monday.getDate() + 7);
  return monday;
}

// the 7 dates (Mon..Sun) of the week containing `date`
function weekDates(date) {
  const monday = mondayOf(date);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function isoDay(d) { return d.toISOString().split('T')[0]; }

// the nth occurrence of `weekday` in `month` (1-12) of `date`'s year
function nthWeekdayDate(date, month, weekday, n) {
  const year = date.getFullYear();
  const targetDow = WEEKDAY_INDEX[weekday];
  let count = 0;
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const dow = (d.getDay() + 6) % 7; // convert JS Sun=0..Sat=6 → Mon=0..Sun=6
    if (dow === targetDow) {
      count += 1;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

// Monday of the first Mon-Sun week fully contained in `month` (1-12)
function firstFullWeekMonday(date, month) {
  const year = date.getFullYear();
  let d = new Date(year, month - 1, 1);
  // advance to the first Monday on/after the 1st
  while (((d.getDay() + 6) % 7) !== 0) d.setDate(d.getDate() + 1);
  // that Monday's whole week (Mon..Sun) must stay within the month
  const sunday = new Date(d);
  sunday.setDate(d.getDate() + 6);
  if (sunday.getMonth() !== month - 1) d.setDate(d.getDate() + 7);
  return d;
}

// the last `weekday` in `month` (1-12) of `date`'s year (e.g. Memorial Day = last Monday in May)
function lastWeekdayDate(date, month, weekday) {
  const year = date.getFullYear();
  const targetDow = WEEKDAY_INDEX[weekday];
  const d = new Date(year, month, 0); // last day of `month`
  while (((d.getDay() + 6) % 7) !== targetDow) d.setDate(d.getDate() - 1);
  return d;
}

// returns the matching Date within `days` for a rule, or null if no match.
// (single source of truth for both "does this rule fire this week" and
// "which day of the week does it land on", so overrides can target the
// right slot instead of always the first one.)
function matchedDateFor(rule, days) {
  switch (rule.type) {
    case 'nth_weekday_of_month': {
      const target = nthWeekdayDate(days[0], rule.month, rule.weekday, rule.n);
      if (!target) return null;
      return days.find(d => isoDay(d) === isoDay(target)) || null;
    }
    case 'last_weekday_of_month': {
      const target = lastWeekdayDate(days[0], rule.month, rule.weekday);
      return days.find(d => isoDay(d) === isoDay(target)) || null;
    }
    case 'fixed_date': {
      return days.find(d => d.getMonth() === rule.month - 1 && d.getDate() === rule.day) || null;
    }
    case 'first_full_week_of_month': {
      const monday = firstFullWeekMonday(days[0], rule.month);
      return isoDay(mondayOf(days[0])) === isoDay(monday) ? days[0] : null;
    }
    case 'monthly_day': {
      return days.find(d => d.getMonth() !== 9 && d.getDate() === rule.day) || null; // skip October (month idx 9)
    }
    case 'explicit_range': {
      const start = new Date(rule.start);
      const end = new Date(rule.end);
      return days.find(d => d >= start && d <= end) || null;
    }
    default:
      return null;
  }
}

// returns calendar entries active for the Mon-Sun week containing `date`,
// sorted by priority desc (highest first). Each entry is annotated with
// `matchedDay` (MON..SUN) — the actual day within the week the rule landed
// on — so callers can target that slot instead of guessing.
function getActiveEntries(date = new Date()) {
  const calendar = store.getCalendar();
  if (!calendar || !calendar.entries) return [];
  const days = weekDates(date);

  return calendar.entries
    .map(entry => {
      const matched = matchedDateFor(entry.rule, days);
      if (!matched) return null;
      return { ...entry, matchedDay: DAY_ABBR[(matched.getDay() + 6) % 7] };
    })
    .filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

module.exports = {
  getActiveEntries,
  mondayOf,
  weekDates,
  nextWeekDate,
};
