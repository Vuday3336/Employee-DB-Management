'use strict';
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const isoWeek = require('dayjs/plugin/isoWeek');
const quarterOfYear = require('dayjs/plugin/quarterOfYear');
dayjs.extend(utc);
dayjs.extend(isoWeek);
dayjs.extend(quarterOfYear);

/** Normalise any date-ish value to UTC midnight — the canonical key for a "day". */
const startOfDay = (d) => dayjs.utc(d).startOf('day').toDate();
const endOfDay = (d) => dayjs.utc(d).endOf('day').toDate();
const startOfMonth = (d) => dayjs.utc(d).startOf('month').toDate();
const endOfMonth = (d) => dayjs.utc(d).endOf('month').toDate();

const isWeekend = (d) => [0, 6].includes(dayjs.utc(d).day());

/** Inclusive list of UTC-midnight dates between two bounds. */
function eachDay(start, end) {
  const out = [];
  let cursor = dayjs.utc(start).startOf('day');
  const last = dayjs.utc(end).startOf('day');
  while (cursor.isSame(last) || cursor.isBefore(last)) {
    out.push(cursor.toDate());
    cursor = cursor.add(1, 'day');
  }
  return out;
}

/**
 * Business days between two dates, excluding weekends and the supplied holidays.
 * `holidays` is an array of Date objects (compared at day precision).
 */
function businessDays(start, end, holidays = []) {
  const holidayKeys = new Set(holidays.map((h) => dayjs.utc(h).format('YYYY-MM-DD')));
  return eachDay(start, end).filter(
    (d) => !isWeekend(d) && !holidayKeys.has(dayjs.utc(d).format('YYYY-MM-DD'))
  ).length;
}

/** "09:15" on the given day, in UTC — used to decide late check-ins. */
function timeOnDay(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return dayjs.utc(date).startOf('day').hour(h).minute(m).toDate();
}

module.exports = {
  dayjs,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  isWeekend,
  eachDay,
  businessDays,
  timeOnDay,
};
