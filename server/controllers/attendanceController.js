'use strict';
const { db, noFilter } = require('../db');
const { ATTENDANCE_COLS } = require('../db/shapes');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const env = require('../config/env');
const { parsePagination, buildMeta } = require('../utils/query');
const { isWeekend, timeOnDay, dayjs } = require('../utils/dates');
const { toCSV } = require('../utils/csv');

const day = (d) => dayjs.utc(d).format('YYYY-MM-DD');
const today = () => day(new Date());

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

const fetchOne = async (employeeId, date) =>
  (await db`select ${db.unsafe(ATTENDANCE_COLS)} from attendance a
            where a.employee_id = ${employeeId} and a.date = ${date}`)[0] || null;

/**
 * POST /api/attendance/check-in
 * Idempotent per day. Late is decided by comparing the check-in time against the
 * configured start of the working day rather than trusting the client.
 */
const checkIn = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const date = day(at);

  const existing = await fetchOne(employeeId, date);
  if (existing?.checkIn) {
    throw ApiError.conflict(`Already checked in at ${dayjs.utc(existing.checkIn).format('HH:mm')}`);
  }

  const status = at > timeOnDay(date, env.WORK_DAY_START) ? 'late' : 'present';
  const source = String(employeeId) === String(req.user.employee) ? 'self' : req.user.role;

  const [row] = await db`
    insert into attendance (employee_id, date, status, check_in, notes, source, recorded_by)
    values (${employeeId}, ${date}, ${status}, ${at}, ${req.body.notes || null}, ${source}, ${req.user._id})
    on conflict (employee_id, date) do update
      set status = excluded.status, check_in = excluded.check_in,
          notes = coalesce(excluded.notes, attendance.notes),
          source = excluded.source, recorded_by = excluded.recorded_by
    returning id`;

  await audit.record(req, {
    action: 'attendance.check_in',
    entity: 'Attendance',
    entityId: row.id,
    after: { date, status },
  });

  res.status(existing ? 200 : 201).json({ success: true, data: await fetchOne(employeeId, date) });
});

/** POST /api/attendance/check-out — closes the record and computes worked minutes. */
const checkOut = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  const at = req.body.at ? new Date(req.body.at) : new Date();
  const date = day(at);

  const record = await fetchOne(employeeId, date);
  if (!record || !record.checkIn) throw ApiError.badRequest('No check-in found for today');
  if (record.checkOut) {
    throw ApiError.conflict(`Already checked out at ${dayjs.utc(record.checkOut).format('HH:mm')}`);
  }
  if (at <= new Date(record.checkIn)) throw ApiError.badRequest('Check-out must be after check-in');

  const minutes = Math.round((at - new Date(record.checkIn)) / 60000);
  // Under four hours of presence counts as a half day.
  const status = minutes < 240 && record.status !== 'late' ? 'half_day' : record.status;

  await db`
    update attendance set check_out = ${at}, worked_minutes = ${minutes}, status = ${status}
    where employee_id = ${employeeId} and date = ${date}`;

  await audit.record(req, {
    action: 'attendance.check_out',
    entity: 'Attendance',
    entityId: record._id,
    after: { workedMinutes: minutes },
  });

  res.json({ success: true, data: await fetchOne(employeeId, date) });
});

/** GET /api/attendance/today — the caller's own record for today. */
const todayRecord = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req);
  res.json({ success: true, data: await fetchOne(employeeId, today()) });
});

function rangeClause(q) {
  if (q.month) {
    const base = dayjs.utc(`${q.month}-01`);
    return db`and a.date between ${base.startOf('month').format('YYYY-MM-DD')}
                             and ${base.endOf('month').format('YYYY-MM-DD')}`;
  }
  if (q.from && q.to) return db`and a.date between ${day(q.from)} and ${day(q.to)}`;
  if (q.from) return db`and a.date >= ${day(q.from)}`;
  if (q.to) return db`and a.date <= ${day(q.to)}`;
  return noFilter();
}

/** GET /api/attendance — scoped, filterable attendance log. */
const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(q);

  let scopeClause;
  if (q.employee) {
    const id = await resolveTarget(req, q.employee);
    scopeClause = db`and a.employee_id = ${id}`;
  } else {
    const visible = await scopeService.visibleEmployeeIds(req.user);
    scopeClause = visible === null ? noFilter() : db`and a.employee_id = any(${visible}::uuid[])`;
  }

  const where = db`where true ${scopeClause} ${rangeClause(q)} ${
    q.status ? db`and a.status = ${q.status}` : noFilter()
  }`;

  const [items, [{ count }]] = await Promise.all([
    db`select ${db.unsafe(ATTENDANCE_COLS)},
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                                'employeeCode', e.employee_code, 'jobTitle', e.job_title) as "employee"
       from attendance a join employees e on e.id = a.employee_id
       ${where} order by a.date desc limit ${limit} offset ${skip}`,
    db`select count(*)::int from attendance a ${where}`,
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total: count }) });
});

/**
 * GET /api/attendance/calendar
 * A full month of day cells for one employee, with weekends and public holidays
 * filled in so the UI never has to guess what an empty day means.
 */
const calendar = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req, req.query.employee);
  const base = req.query.month ? dayjs.utc(`${req.query.month}-01`) : dayjs.utc();
  const from = base.startOf('month');
  const to = base.endOf('month');

  const [records, holidays] = await Promise.all([
    db`select ${db.unsafe(ATTENDANCE_COLS)} from attendance a
       where a.employee_id = ${employeeId}
         and a.date between ${from.format('YYYY-MM-DD')} and ${to.format('YYYY-MM-DD')}`,
    db`select name, date from holidays
       where date between ${from.format('YYYY-MM-DD')} and ${to.format('YYYY-MM-DD')}`,
  ]);

  const byDate = new Map(records.map((r) => [day(r.date), r]));
  const holidayByDate = new Map(holidays.map((h) => [day(h.date), h]));

  const days = [];
  for (let i = 0; i < base.daysInMonth(); i += 1) {
    const date = from.add(i, 'day');
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

  const summary = await reportService.monthlyAttendanceSummary(employeeId, base.toDate());
  res.json({ success: true, data: { month: base.format('YYYY-MM'), days, summary } });
});

/** GET /api/attendance/summary — monthly aggregation for one employee. */
const summary = asyncHandler(async (req, res) => {
  const employeeId = await resolveTarget(req, req.query.employee);
  const base = req.query.month ? dayjs.utc(`${req.query.month}-01`).toDate() : new Date();
  res.json({ success: true, data: await reportService.monthlyAttendanceSummary(employeeId, base) });
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

  const date = day(req.body.date);
  const before = await fetchOne(employeeId, date);
  const { checkIn, checkOut, status, notes } = req.body;
  const minutes =
    checkIn && checkOut ? Math.max(0, Math.round((new Date(checkOut) - new Date(checkIn)) / 60000)) : 0;

  await db`
    insert into attendance (employee_id, date, status, check_in, check_out, worked_minutes, notes, source, recorded_by)
    values (${employeeId}, ${date}, ${status}, ${checkIn || null}, ${checkOut || null},
            ${minutes}, ${notes || null}, ${req.user.role}, ${req.user._id})
    on conflict (employee_id, date) do update
      set status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
          worked_minutes = excluded.worked_minutes, notes = excluded.notes,
          source = excluded.source, recorded_by = excluded.recorded_by`;

  const after = await fetchOne(employeeId, date);

  await audit.record(req, {
    action: 'attendance.override',
    entity: 'Attendance',
    entityId: after._id,
    before,
    after,
  });

  res.json({ success: true, data: after });
});

/** GET /api/attendance/export — CSV of the current filter. */
const exportCsv = asyncHandler(async (req, res) => {
  let scopeClause;
  if (req.query.employee) {
    const id = await resolveTarget(req, req.query.employee);
    scopeClause = db`and a.employee_id = ${id}`;
  } else {
    const visible = await scopeService.visibleEmployeeIds(req.user);
    scopeClause = visible === null ? noFilter() : db`and a.employee_id = any(${visible}::uuid[])`;
  }

  const rows = await db`
    select ${db.unsafe(ATTENDANCE_COLS)}, e.first_name as "firstName", e.last_name as "lastName",
           e.employee_code as "employeeCode"
    from attendance a join employees e on e.id = a.employee_id
    where true ${scopeClause} ${rangeClause(req.query)}
    order by a.date desc limit 5000`;

  const csv = toCSV(rows, [
    { key: 'employeeCode', header: 'Employee Code' },
    { header: 'Employee', map: (r) => `${r.firstName} ${r.lastName}` },
    { header: 'Date', map: (r) => day(r.date) },
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
  const visible = await scopeService.visibleEmployeeIds(req.user);
  const data = await db`
    select e.id as "_id", e.first_name || ' ' || e.last_name as name, e.job_title as "jobTitle",
           e.avatar_url as "avatarUrl",
           coalesce(a.status::text, 'not_marked') as "status",
           a.check_in as "checkIn", a.check_out as "checkOut"
    from employees e
    left join attendance a on a.employee_id = e.id and a.date = ${today()}
    where e.deleted_at is null and e.status <> 'terminated'
      ${visible === null ? noFilter() : db`and e.id = any(${visible}::uuid[])`}
    order by e.first_name`;

  res.json({ success: true, data });
});

module.exports = {
  checkIn,
  checkOut,
  today: todayRecord,
  list,
  calendar,
  summary,
  upsert,
  exportCsv,
  teamToday,
};
