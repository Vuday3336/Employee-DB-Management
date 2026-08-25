'use strict';
const cron = require('node-cron');
const { Employee, Attendance, Holiday, LeavePolicy, LeaveRequest } = require('../models');
const logger = require('../utils/logger');
const notify = require('../services/notificationService');
const { startOfDay, isWeekend, dayjs } = require('../utils/dates');

const tasks = [];

/**
 * Closes out the previous working day: anyone with no attendance row and no
 * approved leave is marked absent, so the monthly rate is not silently inflated
 * by missing records. Runs at 02:00 daily.
 */
async function markMissingAsAbsent(forDate = dayjs.utc().subtract(1, 'day').toDate()) {
  const day = startOfDay(forDate);
  if (isWeekend(day)) return { skipped: 'weekend' };
  if (await Holiday.findOne({ date: day }).lean()) return { skipped: 'holiday' };

  const employees = await Employee.find({ deletedAt: null, status: { $in: ['active', 'probation'] } })
    .select('_id')
    .lean();

  const marked = await Attendance.find({ date: day, employee: { $in: employees.map((e) => e._id) } })
    .select('employee')
    .lean();
  const markedIds = new Set(marked.map((m) => String(m.employee)));

  const missing = employees.filter((e) => !markedIds.has(String(e._id)));
  if (!missing.length) return { absent: 0 };

  await Attendance.bulkWrite(
    missing.map((e) => ({
      updateOne: {
        filter: { employee: e._id, date: day },
        update: {
          $setOnInsert: {
            employee: e._id,
            date: day,
            status: 'absent',
            source: 'system',
            notes: 'Auto-marked: no check-in recorded',
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  logger.info(`[cron] marked ${missing.length} employee(s) absent for ${dayjs.utc(day).format('YYYY-MM-DD')}`);
  return { absent: missing.length };
}

/**
 * Monthly leave accrual: each accruing policy adds one twelfth of its annual quota
 * to every active employee's entitlement. Runs 00:30 on the 1st.
 */
async function accrueLeave() {
  const policies = await LeavePolicy.find({ isActive: true, accrues: true }).lean();
  if (!policies.length) return { updated: 0 };

  const employees = await Employee.find({ deletedAt: null, status: { $in: ['active', 'probation'] } });
  let updated = 0;

  for (const employee of employees) {
    let changed = false;
    for (const policy of policies) {
      const monthly = Math.round((policy.annualQuota / 12) * 100) / 100;
      const bucket = employee.leaveBalances.find((b) => b.type === policy.type);
      if (bucket) {
        // Never accrue past the annual quota plus whatever was carried forward.
        const cap = policy.annualQuota + bucket.carriedForward;
        if (bucket.entitled < cap) {
          bucket.entitled = Math.min(cap, bucket.entitled + monthly);
          changed = true;
        }
      } else {
        employee.leaveBalances.push({ type: policy.type, entitled: monthly, used: 0, carriedForward: 0 });
        changed = true;
      }
    }
    if (changed) {
      await employee.save();
      updated += 1;
    }
  }

  logger.info(`[cron] accrued leave for ${updated} employee(s)`);
  return { updated };
}

/** Nudges approvers about requests that have been sitting for more than three days. */
async function remindPendingApprovals() {
  const threshold = dayjs.utc().subtract(3, 'day').toDate();
  const stale = await LeaveRequest.find({ status: 'pending', createdAt: { $lte: threshold } })
    .populate('employee', 'firstName lastName manager')
    .lean();

  let sent = 0;
  for (const request of stale) {
    const managerId = request.employee?.manager;
    if (!managerId) continue;
    await notify.notifyEmployee(managerId, {
      type: 'leave_submitted',
      title: 'Leave request still waiting',
      message: `${request.employee.firstName} ${request.employee.lastName}'s ${request.type} request has been pending since ${dayjs
        .utc(request.createdAt)
        .format('DD MMM')}.`,
      link: `/leave/${request._id}`,
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
