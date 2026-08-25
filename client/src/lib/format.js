import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import relativeTime from 'dayjs/plugin/relativeTime';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';

dayjs.extend(utc);
dayjs.extend(relativeTime);
dayjs.extend(quarterOfYear);

export const fmtDate = (d) => (d ? dayjs.utc(d).format('DD MMM YYYY') : '—');
export const fmtShortDate = (d) => (d ? dayjs.utc(d).format('DD MMM') : '—');
export const fmtDateTime = (d) => (d ? dayjs.utc(d).format('DD MMM YYYY, HH:mm') : '—');
export const fmtTime = (d) => (d ? dayjs.utc(d).format('HH:mm') : '—');
export const fmtMonth = (d) => dayjs.utc(d).format('MMMM YYYY');
export const fromNow = (d) => (d ? dayjs.utc(d).fromNow() : '—');
export const monthKey = (d = new Date()) => dayjs.utc(d).format('YYYY-MM');
export const inputDate = (d) => (d ? dayjs.utc(d).format('YYYY-MM-DD') : '');

export const fmtHours = (minutes = 0) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
};

export const fmtMoney = (value) =>
  value === undefined || value === null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export const dateRangeLabel = (start, end) =>
  dayjs.utc(start).isSame(dayjs.utc(end), 'day')
    ? fmtDate(start)
    : `${fmtShortDate(start)} – ${fmtDate(end)}`;

export { dayjs };
