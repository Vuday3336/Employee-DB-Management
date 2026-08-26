'use strict';
const { db, noFilter } = require('../db');
const { LEAVE_COLS, REVIEW_COLS, ATTENDANCE_COLS, employeeMini } = require('../db/shapes');
const asyncHandler = require('../utils/asyncHandler');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const leaveService = require('../services/leaveService');
const { dayjs } = require('../utils/dates');
const logger = require('../utils/logger');

const today = () => dayjs.utc().format('YYYY-MM-DD');

/**
 * GET /api/dashboard
 * One scoped snapshot. Every metric is restricted
 * to the caller's visible employee set inside the WHERE clause, so a manager's
 * "headcount" is their team's headcount, not the company's.
 */
const overview = asyncHandler(async (req, res) => {
  const scope = await scopeService.visibleEmployeeIds(req.user);
  const inScope = (col) => (scope === null ? noFilter() : db`and ${db.unsafe(col)} = any(${scope}::uuid[])`);

  // Sequential rather than Promise.all: the pool is capped at one connection on
  // serverless, so "parallel" queries only queue behind each other anyway, and
  // a step that misbehaves is far easier to attribute when it is not racing.
  const step = async (label, fn) => {
    const started = Date.now();
    const result = await fn();
    logger.debug(`[dashboard] ${label} ${Date.now() - started}ms`);
    return result;
  };

  const headcountByDepartment = await step('headcount', () => reportService.headcountByDepartment(scope));
  const attendance = await step('attendanceRate', () => reportService.attendanceRate(scope));
  const leave = await step('leaveBreakdown', () => reportService.leaveBreakdown(scope));
  const attendanceTrend = await step('attendanceTrend', () => reportService.attendanceTrend(scope, 6));
  const hiringTrend = await step('hiringTrend', () => reportService.hiringTrend(scope, 12));
  const performance = await step('performance', () => reportService.performanceByDepartment(scope));
  const [counts] = await step('kpiCounts', () => db`
      select
        (select count(*)::int from employees e
         where e.deleted_at is null and e.status <> 'terminated' ${inScope('e.id')})   as "headcount",
        (select count(*)::int from employees e
         where e.deleted_at is null and e.hire_date >= date_trunc('month', now())
         ${inScope('e.id')})                                                          as "newThisMonth",
        (select count(*)::int from attendance a
         where a.date = ${today()} and a.status = 'on_leave' ${inScope('a.employee_id')}) as "onLeaveToday",
        (select count(*)::int from performance_reviews r
         where r.status = 'draft' ${inScope('r.employee_id')})                        as "draftReviews"`);
  const stale = await step('stalePending', () => reportService.stalePendingApprovals(scope));

  res.json({
    success: true,
    data: {
      scope: req.user.role === 'admin' ? 'organisation' : 'your team',
      kpis: {
        headcount: counts.headcount,
        newThisMonth: counts.newThisMonth,
        pendingLeave: leave.pending,
        attendanceRate: attendance.rate,
        onLeaveToday: counts.onLeaveToday,
        draftReviews: counts.draftReviews,
      },
      attendance,
      headcountByDepartment,
      leave,
      attendanceTrend,
      hiringTrend,
      performance,
      stalePendingApprovals: stale,
    },
  });
});

/**
 * GET /api/dashboard/me
 * The employee-facing landing panel: today's attendance, leave balance, upcoming
 * time off and the latest shared review.
 */
const myOverview = asyncHandler(async (req, res) => {
  const employeeId = req.user.employee;
  if (!employeeId) return res.json({ success: true, data: { linked: false } });

  const [attendanceToday] = await db`
    select ${db.unsafe(ATTENDANCE_COLS)} from attendance a
    where a.employee_id = ${employeeId} and a.date = ${today()}`;

  const balances = await leaveService.balanceSummary(employeeId);

  const upcomingLeave = await db`
    select ${db.unsafe(LEAVE_COLS)} from leave_requests l
    where l.employee_id = ${employeeId} and l.status in ('pending','approved')
      and l.end_date >= ${today()}
    order by l.start_date limit 5`;

  const [latestReview] = await db`
    select ${db.unsafe(REVIEW_COLS)}, ${db.unsafe(employeeMini('rv'))} as "reviewer"
    from performance_reviews r join employees rv on rv.id = r.reviewer_id
    where r.employee_id = ${employeeId} and r.status in ('submitted','acknowledged')
    order by r.period_year desc, r.period_quarter desc limit 1`;

  const monthSummary = await reportService.monthlyAttendanceSummary(employeeId);

  const [{ pending }] = await db`
    select count(*)::int as pending from leave_requests
    where employee_id = ${employeeId} and status = 'pending'`;

  res.json({
    success: true,
    data: {
      linked: true,
      attendanceToday: attendanceToday || null,
      balances,
      upcomingLeave,
      latestReview: latestReview || null,
      monthSummary,
      pendingRequests: pending,
    },
  });
});

module.exports = { overview, myOverview };
