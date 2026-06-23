'use strict';

// calendar.js — evaluates templates/calendar.json against a given week.
//
// Only called from lib/planner.js's base/september branch — October is fully
// owned by october-campaign.json and never reaches this module (see
// calendar.json's _purpose note). Returns the calendar entries whose rule
// matches ANY day in the Mon-Sun week containing `date`.

const store = require('./store');

const WEEKDAY_INDEX = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

// Monday (00:00) of the week containing `date`
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
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

function matchesRule(rule, days) {
  switch (rule.type) {
    case 'nth_weekday_of_month': {
      const target = nthWeekdayDate(days[0], rule.month, rule.weekday, rule.n);
      if (!target) return false;
      return days.some(d => isoDay(d) === isoDay(target));
    }
    case 'first_full_week_of_month': {
      const monday = firstFullWeekMonday(days[0], rule.month);
      return isoDay(mondayOf(days[0])) === isoDay(monday);
    }
    case 'monthly_day': {
      return days.some(d => d.getMonth() !== 9 && d.getDate() === rule.day); // skip October (month idx 9)
    }
    case 'explicit_range': {
      const start = new Date(rule.start);
      const end = new Date(rule.end);
      return days.some(d => d >= start && d <= end);
    }
    default:
      return false;
  }
}

// returns calendar entries active for the Mon-Sun week containing `date`,
// sorted by priority desc (highest first)
function getActiveEntries(date = new Date()) {
  const calendar = store.getCalendar();
  if (!calendar || !calendar.entries) return [];
  const days = weekDates(date);

  return calendar.entries
    .filter(entry => matchesRule(entry.rule, days))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

module.exports = {
  getActiveEntries,
  mondayOf,
  weekDates,
};
