'use strict';
const mongoose = require('mongoose');
const { Employee, Attendance, LeaveRequest, PerformanceReview } = require('../models');
const { startOfMonth, endOfMonth, dayjs } = require('../utils/dates');

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Applies the caller's visibility scope to a pipeline. `null` means unrestricted (admin). */
const scopeMatch = (ids, field = '_id') => (ids === null ? {} : { [field]: { $in: ids.map(oid) } });

const monthKey = {
  $concat: [
    { $toString: { $year: '$date' } },
    '-',
    {
      $cond: [
        { $lt: [{ $month: '$date' }, 10] },
        { $concat: ['0', { $toString: { $month: '$date' } }] },
        { $toString: { $month: '$date' } },
      ],
    },
  ],
};

/** Headcount per department, with the average tenure of each team. */
async function headcountByDepartment(scopeIds) {
  return Employee.aggregate([
    { $match: { deletedAt: null, status: { $ne: 'terminated' }, ...scopeMatch(scopeIds) } },
    {
      $group: {
        _id: '$department',
        headcount: { $sum: 1 },
        avgTenureDays: { $avg: { $divide: [{ $subtract: ['$$NOW', '$hireDate'] }, 86400000] } },
      },
    },
    { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
    { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        departmentId: '$_id',
        department: { $ifNull: ['$dept.name', 'Unassigned'] },
        code: '$dept.code',
        headcount: 1,
        avgTenureMonths: { $round: [{ $divide: ['$avgTenureDays', 30.44] }, 1] },
      },
    },
    { $sort: { headcount: -1 } },
  ]);
}

/** Attendance rate for a month: present + late + half-day credit over recorded working days. */
async function attendanceRate(scopeIds, month = new Date()) {
  const [row] = await Attendance.aggregate([
    {
      $match: {
        date: { $gte: startOfMonth(month), $lte: endOfMonth(month) },
        status: { $nin: ['weekend', 'holiday'] },
        ...scopeMatch(scopeIds, 'employee'),
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        halfDays: { $sum: { $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'on_leave'] }, 1, 0] } },
        workedMinutes: { $sum: '$workedMinutes' },
      },
    },
    {
      $project: {
        _id: 0,
        total: 1,
        present: 1,
        late: 1,
        absent: 1,
        onLeave: 1,
        halfDays: 1,
        avgHours: {
          $round: [{ $divide: ['$workedMinutes', { $multiply: [{ $max: ['$total', 1] }, 60] }] }, 1],
        },
        rate: {
          $round: [
            {
              $multiply: [
                {
                  $divide: [
                    { $add: ['$present', { $multiply: ['$halfDays', 0.5] }] },
                    { $max: ['$total', 1] },
                  ],
                },
                100,
              ],
            },
            1,
          ],
        },
      },
    },
  ]);

  return (
    row || { total: 0, present: 0, late: 0, absent: 0, onLeave: 0, halfDays: 0, rate: 0, avgHours: 0 }
  );
}

/** Leave requests grouped by status, plus a by-type breakdown of approved days. */
async function leaveBreakdown(scopeIds) {
  const [byStatus, byType] = await Promise.all([
    LeaveRequest.aggregate([
      { $match: scopeMatch(scopeIds, 'employee') },
      { $group: { _id: '$status', count: { $sum: 1 }, days: { $sum: '$days' } } },
      { $project: { _id: 0, status: '$_id', count: 1, days: 1 } },
    ]),
    LeaveRequest.aggregate([
      { $match: { status: 'approved', ...scopeMatch(scopeIds, 'employee') } },
      { $group: { _id: '$type', days: { $sum: '$days' }, count: { $sum: 1 } } },
      { $project: { _id: 0, type: '$_id', days: 1, count: 1 } },
      { $sort: { days: -1 } },
    ]),
  ]);

  const pending = byStatus.find((s) => s.status === 'pending')?.count || 0;
  return { byStatus, byType, pending };
}

/** Monthly attendance trend for the dashboard chart. */
async function attendanceTrend(scopeIds, months = 6) {
  const from = dayjs.utc().subtract(months - 1, 'month').startOf('month').toDate();
  return Attendance.aggregate([
    {
      $match: {
        date: { $gte: from },
        status: { $nin: ['weekend', 'holiday'] },
        ...scopeMatch(scopeIds, 'employee'),
      },
    },
    {
      $group: {
        _id: monthKey,
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        month: '$_id',
        total: 1,
        present: 1,
        absent: 1,
        late: 1,
        rate: { $round: [{ $multiply: [{ $divide: ['$present', { $max: ['$total', 1] }] }, 100] }, 1] },
      },
    },
  ]);
}

/** Hires per month over the last N months. */
async function hiringTrend(scopeIds, months = 12) {
  const from = dayjs.utc().subtract(months - 1, 'month').startOf('month').toDate();
  return Employee.aggregate([
    { $match: { hireDate: { $gte: from }, deletedAt: null, ...scopeMatch(scopeIds) } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$hireDate' } },
        hires: { $sum: 1 },
      },
    },
    { $project: { _id: 0, month: '$_id', hires: 1 } },
    { $sort: { month: 1 } },
  ]);
}

/** Average latest performance rating per department. */
async function performanceByDepartment(scopeIds) {
  return PerformanceReview.aggregate([
    {
      $match: {
        status: { $in: ['submitted', 'acknowledged'] },
        ...scopeMatch(scopeIds, 'employee'),
      },
    },
    { $sort: { 'period.year': -1, 'period.quarter': -1 } },
    { $group: { _id: '$employee', rating: { $first: '$rating' } } },
    { $lookup: { from: 'employees', localField: '_id', foreignField: '_id', as: 'emp' } },
    { $unwind: '$emp' },
    { $group: { _id: '$emp.department', avgRating: { $avg: '$rating' }, reviewed: { $sum: 1 } } },
    { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
    { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        department: { $ifNull: ['$dept.name', 'Unassigned'] },
        avgRating: { $round: ['$avgRating', 2] },
        reviewed: 1,
      },
    },
    { $sort: { avgRating: -1 } },
  ]);
}

/** Per-employee monthly attendance summary for the attendance page. */
async function monthlyAttendanceSummary(employeeId, month = new Date()) {
  const match = {
    employee: oid(employeeId),
    date: { $gte: startOfMonth(month), $lte: endOfMonth(month) },
  };

  const breakdown = await Attendance.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 }, minutes: { $sum: '$workedMinutes' } } },
    {
      $project: {
        _id: 0,
        status: '$_id',
        count: 1,
        hours: { $round: [{ $divide: ['$minutes', 60] }, 1] },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const totals = breakdown.reduce(
    (acc, row) => {
      if (!['weekend', 'holiday'].includes(row.status)) acc.workingDays += row.count;
      if (['present', 'late'].includes(row.status)) acc.presentDays += row.count;
      if (row.status === 'late') acc.lateDays += row.count;
      if (row.status === 'absent') acc.absentDays += row.count;
      acc.hours += row.hours;
      return acc;
    },
    { workingDays: 0, presentDays: 0, lateDays: 0, absentDays: 0, hours: 0 }
  );

  return {
    month: dayjs.utc(month).format('YYYY-MM'),
    breakdown,
    ...totals,
    hours: Math.round(totals.hours * 10) / 10,
    rate: totals.workingDays
      ? Math.round((totals.presentDays / totals.workingDays) * 1000) / 10
      : 0,
  };
}

/** Leave requests that have been waiting on an approver for more than three days. */
async function stalePendingApprovals(scopeIds) {
  const threshold = dayjs.utc().subtract(3, 'day').toDate();
  return LeaveRequest.aggregate([
    {
      $match: {
        status: 'pending',
        createdAt: { $lte: threshold },
        ...scopeMatch(scopeIds, 'employee'),
      },
    },
    { $lookup: { from: 'employees', localField: 'employee', foreignField: '_id', as: 'emp' } },
    { $unwind: '$emp' },
    {
      $project: {
        _id: 1,
        type: 1,
        days: 1,
        startDate: 1,
        waitingDays: { $floor: { $divide: [{ $subtract: ['$$NOW', '$createdAt'] }, 86400000] } },
        employeeName: { $concat: ['$emp.firstName', ' ', '$emp.lastName'] },
      },
    },
    { $sort: { waitingDays: -1 } },
    { $limit: 10 },
  ]);
}

/**
 * Full org chart in one query. $graphLookup walks the self-referencing manager edge
 * from every root (manager === null) and the tree is assembled in memory afterwards.
 */
async function orgChart(rootEmployeeId = null) {
  const rootMatch = rootEmployeeId
    ? { _id: oid(rootEmployeeId) }
    : { manager: null, deletedAt: null };

  const roots = await Employee.aggregate([
    { $match: { ...rootMatch, deletedAt: null } },
    {
      $graphLookup: {
        from: 'employees',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'manager',
        as: 'descendants',
        maxDepth: 10,
        restrictSearchWithMatch: { deletedAt: null },
      },
    },
    {
      $project: {
        firstName: 1,
        lastName: 1,
        jobTitle: 1,
        avatarUrl: 1,
        department: 1,
        manager: 1,
        'descendants._id': 1,
        'descendants.firstName': 1,
        'descendants.lastName': 1,
        'descendants.jobTitle': 1,
        'descendants.avatarUrl': 1,
        'descendants.department': 1,
        'descendants.manager': 1,
      },
    },
  ]);

  const node = (e) => ({
    _id: String(e._id),
    name: `${e.firstName} ${e.lastName}`,
    jobTitle: e.jobTitle,
    avatarUrl: e.avatarUrl,
    managerId: e.manager ? String(e.manager) : null,
    reports: [],
  });

  return roots.map((root) => {
    const index = new Map();
    const rootNode = node(root);
    index.set(rootNode._id, rootNode);
    root.descendants.forEach((d) => index.set(String(d._id), node(d)));
    for (const item of index.values()) {
      if (item._id === rootNode._id) continue;
      const parent = index.get(item.managerId);
      if (parent) parent.reports.push(item);
    }
    return rootNode;
  });
}

module.exports = {
  headcountByDepartment,
  attendanceRate,
  leaveBreakdown,
  attendanceTrend,
  hiringTrend,
  performanceByDepartment,
  monthlyAttendanceSummary,
  stalePendingApprovals,
  orgChart,
};
