'use strict';
const { Attendance, Employee, Holiday } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const env = require('../config/env');
const { parsePagination, buildMeta } = require('../utils/query');
const { startOfDay, endOfDay, startOfMonth, endOfMonth, isWeekend, timeOnDay, dayjs } = require('../utils/dates');
const { toCSV } = require('../utils/csv');

/** Resolve which employee a request is about, defaulting to the caller. */
async function resolveTarget(req, explicitId) {
  const employeeId = explicitId || req.body.employee || req.query.employee || req.user.employee;
  if (!employeeId) throw ApiError.badRequest('No employee record is linked to your account');
  if (String(employeeId) !== String(req.user.employee)) {
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
  }
  return String(employeeId);
}

/**
 * POST /api/attendance/check-in
 * Idempotent per day. Late is decided by comparing the check-in time against the
 * configured start of the working day rather than trusting the client.
 */
const checkIn = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const day = startOfDay(at);

  const existing = await Attendance.findOne({ employee: employeeId, date: day });
  if (existing && existing.checkIn) {
    throw ApiError.conflict(`Already checked in at ${dayjs.utc(existing.checkIn).format('HH:mm')}`);
  }

  const cutoff = timeOnDay(day, env.WORK_DAY_START);
  const status = at > cutoff ? 'late' : 'present';

  const record =
    existing ||
    new Attendance({
      employee: employeeId,
      date: day,
      source: String(employeeId) === String(req.user.employee) ? 'self' : req.user.role,
      recordedBy: req.user._id,
    });
  record.checkIn = at;
  record.status = status;
  record.notes = req.body.notes || record.notes;
  await record.save();

  await audit.record(req, {
    action: 'attendance.check_in',
    entity: 'Attendance',
    entityId: record._id,
    after: { date: day, status },
  });

  res.status(existing ? 200 : 201).json({ success: true, data: record });
});

/** POST /api/attendance/check-out — closes the open record and computes worked minutes. */
const checkOut = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const day = startOfDay(at);

  const record = await Attendance.findOne({ employee: employeeId, date: day });
  if (!record || !record.checkIn) throw ApiError.badRequest('No check-in found for today');
  if (record.checkOut) {
    throw ApiError.conflict(`Already checked out at ${dayjs.utc(record.checkOut).format('HH:mm')}`);
  }
  if (at <= record.checkIn) throw ApiError.badRequest('Check-out must be after check-in');

  record.checkOut = at;
  // Under four hours of presence counts as a half day.
  if (Math.round((at - record.checkIn) / 60000) < 240 && record.status !== 'late') {
    record.status = 'half_day';
  }
  await record.save();

  await audit.record(req, {
    action: 'attendance.check_out',
    entity: 'Attendance',
    entityId: record._id,
    after: { workedMinutes: record.workedMinutes },
  });

  res.json({ success: true, data: record });
});

/** GET /api/attendance/today — the caller's own record for today, if any. */
const today = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  const record = await Attendance.findOne({ employee: employeeId, date: startOfDay(new Date()) }).lean();
  res.json({ success: true, data: record });
});

function rangeFromQuery(query) {
  if (query.month) {
    const base = dayjs.utc(`${query.month}-01`).toDate();
    return { $gte: startOfMonth(base), $lte: endOfMonth(base) };
  }
  const range = {};
  if (query.from) range.$gte = startOfDay(query.from);
  if (query.to) range.$lte = endOfDay(query.to);
  return Object.keys(range).length ? range : null;
}

/** GET /api/attendance — scoped, filterable attendance log. */
const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(query);

  const filter = {};
  if (query.employee) {
    filter.employee = await resolveTarget(req, query.employee);
  } else {
    Object.assign(filter, await scopeService.scopeFilter(req.user, 'employee'));
  }
  const range = rangeFromQuery(query);
  if (range) filter.date = range;
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .populate('employee', 'firstName lastName employeeCode jobTitle')
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total }) });
});

/**
 * GET /api/attendance/calendar
 * A full month of day cells for one employee, with weekends and public holidays
 * filled in so the UI never has to guess what an empty day means.
 */
const calendar = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req, req.query.employee);
  const base = req.query.month ? dayjs.utc(`${req.query.month}-01`).toDate() : new Date();
  const from = startOfMonth(base);
  const to = endOfMonth(base);

  const [records, holidays] = await Promise.all([
    Attendance.find({ employee: employeeId, date: { $gte: from, $lte: to } }).lean(),
    Holiday.find({ date: { $gte: from, $lte: to } }).lean(),
  ]);

  const byDate = new Map(records.map((r) => [dayjs.utc(r.date).format('YYYY-MM-DD'), r]));
  const holidayByDate = new Map(holidays.map((h) => [dayjs.utc(h.date).format('YYYY-MM-DD'), h]));

  const days = [];
  const total = dayjs.utc(base).daysInMonth();
  for (let i = 0; i < total; i += 1) {
    const date = dayjs.utc(from).add(i, 'day');
    const key = date.format('YYYY-MM-DD');
    const record = byDate.get(key);
    const holiday = holidayByDate.get(key);
    days.push({
      date: key,
      weekday: date.day(),
      status: record?.status || (holiday ? 'holiday' : isWeekend(date.toDate()) ? 'weekend' : null),
      holidayName: holiday?.name,
      checkIn: record?.checkIn || null,
      checkOut: record?.checkOut || null,
      workedMinutes: record?.workedMinutes || 0,
      notes: record?.notes,
    });
  }

  const summary = await reportService.monthlyAttendanceSummary(employeeId, base);
  res.json({ success: true, data: { month: dayjs.utc(base).format('YYYY-MM'), days, summary } });
});

/** GET /api/attendance/summary — monthly aggregation for one employee. */
const summary = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req, req.query.employee);
  const base = req.query.month ? dayjs.utc(`${req.query.month}-01`).toDate() : new Date();
  const data = await reportService.monthlyAttendanceSummary(employeeId, base);
  res.json({ success: true, data });
});

/**
 * PUT /api/attendance — manual correction by a manager or admin.
 * Upserted on (employee, date) so a correction never produces a duplicate row.
 */
const upsert = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req, req.body.employee);
  if (String(employeeId) === String(req.user.employee) && req.user.role !== 'admin') {
    throw ApiError.forbidden('You cannot hand-edit your own attendance');
  }

  const day = startOfDay(req.body.date);
  const before = await Attendance.findOne({ employee: employeeId, date: day }).lean();

  const record = await Attendance.findOneAndUpdate(
    { employee: employeeId, date: day },
    {
      employee: employeeId,
      date: day,
      status: req.body.status,
      checkIn: req.body.checkIn || null,
      checkOut: req.body.checkOut || null,
      notes: req.body.notes,
      source: req.user.role,
      recordedBy: req.user._id,
      workedMinutes:
        req.body.checkIn && req.body.checkOut
          ? Math.max(0, Math.round((new Date(req.body.checkOut) - new Date(req.body.checkIn)) / 60000))
          : 0,
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await audit.record(req, {
    action: 'attendance.override',
    entity: 'Attendance',
    entityId: record._id,
    before,
    after: record.toObject(),
  });

  res.json({ success: true, data: record });
});

/** GET /api/attendance/export — CSV of the current filter. */
const exportCsv = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = await resolveTarget(req, req.query.employee);
  else Object.assign(filter, await scopeService.scopeFilter(req.user, 'employee'));
  const range = rangeFromQuery(req.query);
  if (range) filter.date = range;

  const rows = await Attendance.find(filter)
    .populate('employee', 'firstName lastName employeeCode')
    .sort({ date: -1 })
    .limit(5000)
    .lean();

  const csv = toCSV(rows, [
    { header: 'Employee Code', map: (r) => r.employee?.employeeCode || '' },
    { header: 'Employee', map: (r) => (r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : '') },
    { header: 'Date', map: (r) => dayjs.utc(r.date).format('YYYY-MM-DD') },
    { key: 'status', header: 'Status' },
    { header: 'Check In', map: (r) => (r.checkIn ? dayjs.utc(r.checkIn).format('HH:mm') : '') },
    { header: 'Check Out', map: (r) => (r.checkOut ? dayjs.utc(r.checkOut).format('HH:mm') : '') },
    { header: 'Hours', map: (r) => (r.workedMinutes / 60).toFixed(2) },
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${Date.now()}.csv"`);
  res.send(csv);
});

/** GET /api/attendance/team-today — who is in, late, out or on leave right now. */
const teamToday = asyncHandler(async (req, res) => {
  const scope = await scopeService.visibleEmployeeIds(req.user);
  const employeeFilter = { deletedAt: null, status: { $ne: 'terminated' } };
  if (scope !== null) employeeFilter._id = { $in: scope };

  const employees = await Employee.find(employeeFilter)
    .select('firstName lastName jobTitle avatarUrl employeeCode')
    .lean();

  const records = await Attendance.find({
    employee: { $in: employees.map((e) => e._id) },
    date: startOfDay(new Date()),
  }).lean();

  const byEmployee = new Map(records.map((r) => [String(r.employee), r]));
  const data = employees.map((e) => {
    const record = byEmployee.get(String(e._id));
    return {
      _id: e._id,
      name: `${e.firstName} ${e.lastName}`,
      jobTitle: e.jobTitle,
      avatarUrl: e.avatarUrl,
      status: record?.status || 'not_marked',
      checkIn: record?.checkIn || null,
      checkOut: record?.checkOut || null,
    };
  });

  res.json({ success: true, data });
});

module.exports = { checkIn, checkOut, today, list, calendar, summary, upsert, exportCsv, teamToday };
