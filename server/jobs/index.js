'use strict';
const cron = require('node-cron');
const { db } = require('../db');
const logger = require('../utils/logger');
const notify = require('../services/notificationService');
const { isWeekend, dayjs } = require('../utils/dates');

const tasks = [];
const day = (d) => dayjs.utc(d).format('YYYY-MM-DD');

/**
 * Closes out the previous working day: anyone with no attendance row and no
 * approved leave is marked absent, so the monthly rate is not silently inflated
 * by missing records. Runs at 02:00 daily.
 */
async function markMissingAsAbsent(forDate = dayjs.utc().subtract(1, 'day').toDate()) {
  const date = day(forDate);
  if (isWeekend(forDate)) return { skipped: 'weekend' };

  const [holiday] = await db`select id from holidays where date = ${date}`;
  if (holiday) return { skipped: 'holiday' };

  // Insert-select with an anti-join: one statement, and the unique index on
  // (employee_id, date) makes a concurrent run harmless.
  const inserted = await db`
    insert into attendance (employee_id, date, status, source, notes)
    select e.id, ${date}, 'absent', 'system', 'Auto-marked: no check-in recorded'
    from employees e
    where e.deleted_at is null
      and e.status in ('active','probation')
      and not exists (
        select 1 from attendance a where a.employee_id = e.id and a.date = ${date}
      )
    on conflict (employee_id, date) do nothing
    returning id`;

  if (inserted.length) {
    logger.info(`[cron] marked ${inserted.length} employee(s) absent for ${date}`);
  }
  return { absent: inserted.length };
}

/**
 * Monthly leave accrual: each accruing policy adds one twelfth of its annual quota
 * to every active employee's entitlement, capped at the annual quota plus whatever
 * was carried forward. Runs 00:30 on the 1st.
 */
async function accrueLeave() {
  const updated = await db`
    update leave_balances b
    set entitled = least(p.annual_quota + b.carried_forward, b.entitled + round(p.annual_quota / 12, 2))
    from leave_policies p, employees e
    where b.type = p.type
      and e.id = b.employee_id
      and p.is_active and p.accrues
      and e.deleted_at is null
      and e.status in ('active','probation')
      and b.entitled < p.annual_quota + b.carried_forward
    returning b.id`;

  logger.info(`[cron] accrued leave on ${updated.length} balance(s)`);
  return { updated: updated.length };
}

/** Nudges approvers about requests that have been sitting for more than three days. */
async function remindPendingApprovals() {
  const stale = await db`
    select l.id, l.type, l.created_at, e.first_name, e.last_name, e.manager_id
    from leave_requests l join employees e on e.id = l.employee_id
    where l.status = 'pending' and l.created_at <= now() - interval '3 days'
      and e.manager_id is not null`;

  let sent = 0;
  for (const request of stale) {
    await notify.notifyEmployee(request.manager_id, {
      type: 'leave_submitted',
      title: 'Leave request still waiting',
      message: `${request.first_name} ${request.last_name}'s ${request.type} request has been pending since ${dayjs
        .utc(request.created_at)
        .format('DD MMM')}.`,
      link: `/leave/${request.id}`,
    });
    sent += 1;
  }
  if (sent) logger.info(`[cron] sent ${sent} approval reminder(s)`);
  return { sent };
}

const guard = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    logger.error(`[cron] ${name} failed:`, err.message);
  }
};

function startJobs() {
  tasks.push(cron.schedule('0 2 * * *', guard('markMissingAsAbsent', markMissingAsAbsent)));
  tasks.push(cron.schedule('30 0 1 * *', guard('accrueLeave', accrueLeave)));
  tasks.push(cron.schedule('0 9 * * 1-5', guard('remindPendingApprovals', remindPendingApprovals)));
  logger.info(`[cron] ${tasks.length} scheduled job(s) started`);
}

function stopJobs() {
  tasks.forEach((t) => t.stop());
  tasks.length = 0;
}

module.exports = { startJobs, stopJobs, markMissingAsAbsent, accrueLeave, remindPendingApprovals };
