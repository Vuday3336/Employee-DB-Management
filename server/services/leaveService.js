'use strict';
const { LeaveRequest, LeavePolicy, Holiday, Employee } = require('../models');
const ApiError = require('../utils/ApiError');
const { businessDays, startOfDay, dayjs } = require('../utils/dates');

async function holidaysBetween(start, end) {
  return Holiday.find({ date: { $gte: startOfDay(start), $lte: startOfDay(end) } })
    .select('date')
    .lean()
    .then((rows) => rows.map((r) => r.date));
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

/** Reject a request that overlaps an existing pending/approved one. */
async function assertNoOverlap(employeeId, startDate, endDate, excludeId = null) {
  const clash = await LeaveRequest.findOne({
    employee: employeeId,
    status: { $in: ['pending', 'approved'] },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  if (clash) {
    throw ApiError.conflict(
      `Overlaps an existing ${clash.status} request (${dayjs.utc(clash.startDate).format('DD MMM')} – ${dayjs
        .utc(clash.endDate)
        .format('DD MMM YYYY')})`
    );
  }
}

/** Policy gate: notice period, max consecutive days, and remaining balance. */
async function assertPolicy(employee, type, startDate, days) {
  const policy = await LeavePolicy.findOne({ type, isActive: true }).lean();
  if (!policy) throw ApiError.badRequest(`Leave type "${type}" is not available`);

  const noticeDays = dayjs.utc(startDate).startOf('day').diff(dayjs.utc().startOf('day'), 'day');
  if (noticeDays < policy.minNoticeDays) {
    throw ApiError.badRequest(`${policy.label} needs at least ${policy.minNoticeDays} days notice`);
  }
  if (days > policy.maxConsecutiveDays) {
    throw ApiError.badRequest(`${policy.label} is capped at ${policy.maxConsecutiveDays} consecutive days`);
  }

  if (policy.isPaid) {
    const remaining = employee.remainingLeave(type);
    if (days > remaining) {
      throw ApiError.badRequest(`Insufficient ${policy.label} balance: ${remaining} day(s) remaining`);
    }
  }
  return policy;
}

/**
 * Balance is only consumed at approval time and released if an approved request is
 * later cancelled — pending requests never lock days away.
 */
async function applyBalance(employeeId, type, delta) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found');
  const bucket = employee.leaveBalances.find((b) => b.type === type);
  if (!bucket) {
    employee.leaveBalances.push({ type, entitled: 0, used: Math.max(0, delta), carriedForward: 0 });
  } else {
    bucket.used = Math.max(0, bucket.used + delta);
  }
  await employee.save();
  return employee;
}

/** Employee-facing balance summary, merged with the active policy catalogue. */
async function balanceSummary(employeeId) {
  const [employee, policies] = await Promise.all([
    Employee.findById(employeeId).lean(),
    LeavePolicy.find({ isActive: true }).lean(),
  ]);
  if (!employee) throw ApiError.notFound('Employee not found');

  return policies.map((policy) => {
    const bucket = employee.leaveBalances.find((b) => b.type === policy.type) || {
      entitled: 0,
      used: 0,
      carriedForward: 0,
    };
    const total = bucket.entitled + bucket.carriedForward;
    return {
      type: policy.type,
      label: policy.label,
      isPaid: policy.isPaid,
      entitled: bucket.entitled,
      carriedForward: bucket.carriedForward,
      used: bucket.used,
      remaining: Math.max(0, total - bucket.used),
      total,
    };
  });
}

module.exports = { computeDays, assertNoOverlap, assertPolicy, applyBalance, balanceSummary };
