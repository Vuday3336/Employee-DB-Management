'use strict';
const { db } = require('../db');
const { LEAVE_COLS, REVIEW_COLS, ATTENDANCE_COLS, employeeMini } = require('../db/shapes');
const asyncHandler = require('../utils/asyncHandler');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const leaveService = require('../services/leaveService');
const { dayjs } = require('../utils/dates');

const today = () => dayjs.utc().format('YYYY-MM-DD');

/**
 * GET /api/dashboard
 * One scoped snapshot, assembled from parallel queries. Every metric is restricted
 * to the caller's visible employee set inside the WHERE clause, so a manager's
 * "headcount" is their team's headcount, not the company's.
 */
const overview = asyncHandler(async (req, res) => {
  const scope = await scopeService.visibleEmployeeIds(req.user);
  const inScope = (col) => (scope === null ? db`` : db`and ${db.unsafe(col)} = any(${scope}::uuid[])`);

  const [
    headcountByDepartment,
    attendance,
    leave,
    attendanceTrend,
    hiringTrend,
    performance,
    [counts],
    stale,
  ] = await Promise.all([
    reportService.headcountByDepartment(scope),
    reportService.attendanceRate(scope),
    reportService.leaveBreakdown(scope),
    reportService.attendanceTrend(scope, 6),
    reportService.hiringTrend(scope, 12),
    reportService.performanceByDepartment(scope),
    db`
      select
        (select count(*)::int from employees e
         where e.deleted_at is null and e.status <> 'terminated' ${inScope('e.id')})   as "headcount",
        (select count(*)::int from employees e
         where e.deleted_at is null and e.hire_date >= date_trunc('month', now())
         ${inScope('e.id')})                                                          as "newThisMonth",
        (select count(*)::int from attendance a
         where a.date = ${today()} and a.status = 'on_leave' ${inScope('a.employee_id')}) as "onLeaveToday",
        (select count(*)::int from performance_reviews r
         where r.status = 'draft' ${inScope('r.employee_id')})                        as "draftReviews"`,
    reportService.stalePendingApprovals(scope),
  ]);

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

  const [[attendanceToday], balances, upcomingLeave, [latestReview], monthSummary, [{ pending }]] =
    await Promise.all([
      db`select ${db.unsafe(ATTENDANCE_COLS)} from attendance a
         where a.employee_id = ${employeeId} and a.date = ${today()}`,
      leaveService.balanceSummary(employeeId),
      db`select ${db.unsafe(LEAVE_COLS)} from leave_requests l
         where l.employee_id = ${employeeId} and l.status in ('pending','approved')
           and l.end_date >= ${today()}
         order by l.start_date limit 5`,
      db`select ${db.unsafe(REVIEW_COLS)}, ${db.unsafe(employeeMini('rv'))} as "reviewer"
         from performance_reviews r join employees rv on rv.id = r.reviewer_id
         where r.employee_id = ${employeeId} and r.status in ('submitted','acknowledged')
         order by r.period_year desc, r.period_quarter desc limit 1`,
      reportService.monthlyAttendanceSummary(employeeId),
      db`select count(*)::int as pending from leave_requests
         where employee_id = ${employeeId} and status = 'pending'`,
    ]);

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
