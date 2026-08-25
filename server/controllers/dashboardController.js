'use strict';
const { Employee, LeaveRequest, PerformanceReview, Attendance } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const leaveService = require('../services/leaveService');
const { startOfDay, dayjs } = require('../utils/dates');

/**
 * GET /api/dashboard
 * One scoped snapshot, assembled from parallel aggregation pipelines. Every metric
 * is restricted to the caller's visible employee set, so a manager's "headcount"
 * is their team's headcount, not the company's.
 */
const overview = asyncHandler(async (req, res) => {
  const scope = await scopeService.visibleEmployeeIds(req.user);
  const employeeMatch = { deletedAt: null, ...(scope === null ? {} : { _id: { $in: scope } }) };

  const [
    headcountByDepartment,
    attendance,
    leave,
    attendanceTrend,
    hiringTrend,
    performance,
    totalHeadcount,
    newThisMonth,
    onLeaveToday,
    pendingReviews,
    stale,
  ] = await Promise.all([
    reportService.headcountByDepartment(scope),
    reportService.attendanceRate(scope),
    reportService.leaveBreakdown(scope),
    reportService.attendanceTrend(scope, 6),
    reportService.hiringTrend(scope, 12),
    reportService.performanceByDepartment(scope),
    Employee.countDocuments({ ...employeeMatch, status: { $ne: 'terminated' } }),
    Employee.countDocuments({
      ...employeeMatch,
      hireDate: { $gte: dayjs.utc().startOf('month').toDate() },
    }),
    Attendance.countDocuments({
      date: startOfDay(new Date()),
      status: 'on_leave',
      ...(scope === null ? {} : { employee: { $in: scope } }),
    }),
    PerformanceReview.countDocuments({
      status: 'draft',
      ...(scope === null ? {} : { employee: { $in: scope } }),
    }),
    reportService.stalePendingApprovals(scope),
  ]);

  res.json({
    success: true,
    data: {
      scope: req.user.role === 'admin' ? 'organisation' : 'your team',
      kpis: {
        headcount: totalHeadcount,
        newThisMonth,
        pendingLeave: leave.pending,
        attendanceRate: attendance.rate,
        onLeaveToday,
        draftReviews: pendingReviews,
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
  if (!employeeId) {
    return res.json({ success: true, data: { linked: false } });
  }

  const [attendanceToday, balances, upcoming, latestReview, monthSummary, pendingCount] =
    await Promise.all([
      Attendance.findOne({ employee: employeeId, date: startOfDay(new Date()) }).lean(),
      leaveService.balanceSummary(employeeId),
      LeaveRequest.find({
        employee: employeeId,
        status: { $in: ['pending', 'approved'] },
        endDate: { $gte: startOfDay(new Date()) },
      })
        .sort({ startDate: 1 })
        .limit(5)
        .lean(),
      PerformanceReview.findOne({ employee: employeeId, status: { $in: ['submitted', 'acknowledged'] } })
        .sort({ 'period.year': -1, 'period.quarter': -1 })
        .populate('reviewer', 'firstName lastName jobTitle')
        .lean(),
      reportService.monthlyAttendanceSummary(employeeId),
      LeaveRequest.countDocuments({ employee: employeeId, status: 'pending' }),
    ]);

  res.json({
    success: true,
    data: {
      linked: true,
      attendanceToday,
      balances,
      upcomingLeave: upcoming,
      latestReview,
      monthSummary,
      pendingRequests: pendingCount,
    },
  });
});

module.exports = { overview, myOverview };
