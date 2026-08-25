'use strict';
const { db } = require('../db');
const ApiError = require('../utils/ApiError');
const { businessDays, dayjs } = require('../utils/dates');

const day = (d) => dayjs.utc(d).format('YYYY-MM-DD');

async function holidaysBetween(start, end) {
  const rows = await db`select date from holidays where date between ${day(start)} and ${day(end)}`;
  return rows.map((r) => r.date);
}

/** Business-day length of a request, weekends and company holidays removed. */
async function computeDays(startDate, endDate, halfDay = false) {
  const holidays = await holidaysBetween(startDate, endDate);
  const days = businessDays(startDate, endDate, holidays);
  if (days === 0) throw ApiError.badRequest('The selected range contains no working days');
  if (halfDay) {
    if (days > 1) throw ApiError.badRequest('A half day must cover a single date');
    return 0.5;
  }
  return days;
}

/** Reject a request overlapping an existing pending or approved one. */
async function assertNoOverlap(employeeId, startDate, endDate, excludeId = null) {
  const [clash] = await db`
    select id, status, start_date, end_date
    from leave_requests
    where employee_id = ${employeeId}
      and status in ('pending', 'approved')
      and start_date <= ${day(endDate)}
      and end_date   >= ${day(startDate)}
      ${excludeId ? db`and id <> ${excludeId}` : db``}
    limit 1`;

  if (clash) {
    throw ApiError.conflict(
      `Overlaps an existing ${clash.status} request (${dayjs.utc(clash.start_date).format('DD MMM')} – ${dayjs
        .utc(clash.end_date)
        .format('DD MMM YYYY')})`
    );
  }
}

const remainingFor = (balance) =>
  balance ? Number(balance.entitled) + Number(balance.carried_forward) - Number(balance.used) : 0;

/** Policy gate: notice period, consecutive-day cap, and remaining balance. */
async function assertPolicy(employeeId, type, startDate, days) {
  const [policy] = await db`select * from leave_policies where type = ${type} and is_active = true`;
  if (!policy) throw ApiError.badRequest(`Leave type "${type}" is not available`);

  const noticeDays = dayjs.utc(startDate).startOf('day').diff(dayjs.utc().startOf('day'), 'day');
  if (noticeDays < policy.min_notice_days) {
    throw ApiError.badRequest(`${policy.label} needs at least ${policy.min_notice_days} days notice`);
  }
  if (days > policy.max_consecutive_days) {
    throw ApiError.badRequest(`${policy.label} is capped at ${policy.max_consecutive_days} consecutive days`);
  }

  if (policy.is_paid) {
    const [balance] = await db`
      select * from leave_balances where employee_id = ${employeeId} and type = ${type}`;
    const remaining = remainingFor(balance);
    if (days > remaining) {
      throw ApiError.badRequest(`Insufficient ${policy.label} balance: ${remaining} day(s) remaining`);
    }
  }
  return policy;
}

/**
 * Balance is consumed at approval and released if an approved request is later
 * cancelled — pending requests never lock days away. `delta` is signed.
 */
async function applyBalance(employeeId, type, delta) {
  await db`
    insert into leave_balances (employee_id, type, entitled, used, carried_forward)
    values (${employeeId}, ${type}, 0, greatest(0, ${delta}), 0)
    on conflict (employee_id, type)
    do update set used = greatest(0, leave_balances.used + ${delta})`;
}

/** Employee-facing summary, merged with the active policy catalogue. */
async function balanceSummary(employeeId) {
  return db`
    select
      p.type,
      p.label,
      p.is_paid                                          as "isPaid",
      coalesce(b.entitled, 0)::float8                    as "entitled",
      coalesce(b.carried_forward, 0)::float8             as "carriedForward",
      coalesce(b.used, 0)::float8                        as "used",
      (coalesce(b.entitled,0) + coalesce(b.carried_forward,0))::float8 as "total",
      greatest(0, coalesce(b.entitled,0) + coalesce(b.carried_forward,0) - coalesce(b.used,0))::float8 as "remaining"
    from leave_policies p
    left join leave_balances b on b.type = p.type and b.employee_id = ${employeeId}
    where p.is_active = true
    order by p.label`;
}

module.exports = { computeDays, assertNoOverlap, assertPolicy, applyBalance, balanceSummary, holidaysBetween };
