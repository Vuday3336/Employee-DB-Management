'use strict';
const { db } = require('../db');
const { LEAVE_COLS, LEAVE_HISTORY, employeeMini } = require('../db/shapes');
const { LEAVE_TRANSITIONS } = require('../db/enums');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const leaveService = require('../services/leaveService');
const scopeService = require('../services/scopeService');
const notify = require('../services/notificationService');
const { parsePagination, buildMeta } = require('../utils/query');
const { eachDay, isWeekend, dayjs } = require('../utils/dates');

const day = (d) => dayjs.utc(d).format('YYYY-MM-DD');

const SORTS = {
  startDate: 'l.start_date asc',
  '-startDate': 'l.start_date desc',
  endDate: 'l.end_date asc',
  '-endDate': 'l.end_date desc',
  days: 'l.days asc',
  '-days': 'l.days desc',
  status: 'l.status asc',
  '-status': 'l.status desc',
  createdAt: 'l.created_at asc',
  '-createdAt': 'l.created_at desc',
};

const SELECT = `
  ${LEAVE_COLS},
  ${employeeMini('e')} as "employee",
  ${LEAVE_HISTORY}
`;

const fetchOne = async (id) =>
  (await db`select ${db.unsafe(SELECT)} from leave_requests l
            join employees e on e.id = l.employee_id where l.id = ${id}`)[0] || null;

/** The state machine. A transition absent from the table is a 409, not a silent no-op. */
function assertTransition(from, to) {
  if (!(LEAVE_TRANSITIONS[from] || []).includes(to)) {
    throw ApiError.conflict(`Cannot move a ${from} request to ${to}`);
  }
}

/**
 * POST /api/leave
 * An employee files for themselves. Admins and managers may file on behalf of
 * someone inside their scope. Every rule (overlap, notice, quota, balance) runs
 * server-side before the request is persisted.
 */
const create = asyncHandler(async (req, res) => {
  const employeeId = req.body.employee || req.user.employee;
  if (!employeeId) throw ApiError.badRequest('No employee record is linked to your account');

  if (String(employeeId) !== String(req.user.employee)) {
    if (req.user.role === 'employee') throw ApiError.forbidden('You can only file leave for yourself');
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
  }

  const [employee] = await db`
    select * from employees where id = ${employeeId} and deleted_at is null`;
  if (!employee) throw ApiError.notFound('Employee not found');

  const start = day(req.body.startDate);
  const end = day(req.body.endDate);

  await leaveService.assertNoOverlap(employeeId, start, end);
  const days = await leaveService.computeDays(start, end, req.body.halfDay);
  const policy = await leaveService.assertPolicy(employeeId, req.body.type, start, days);

  if (policy.requires_attachment && !req.body.attachmentUrl) {
    throw ApiError.badRequest(`${policy.label} requires a supporting document`);
  }

  const request = await db.begin(async (tx) => {
    const [row] = await tx`
      insert into leave_requests (employee_id, type, start_date, end_date, days, half_day, reason, attachment_url, status)
      values (${employeeId}, ${req.body.type}, ${start}, ${end}, ${days}, ${Boolean(req.body.halfDay)},
              ${req.body.reason}, ${req.body.attachmentUrl || null}, 'pending')
      returning *`;
    await tx`
      insert into leave_request_history (request_id, from_status, to_status, by_user, note)
      values (${row.id}, null, 'pending', ${req.user._id}, 'Request submitted')`;
    return row;
  });

  // Ping whoever has to act on it.
  if (employee.manager_id) {
    await notify.notifyEmployee(employee.manager_id, {
      type: 'leave_submitted',
      title: 'Leave request awaiting your approval',
      message: `${employee.first_name} ${employee.last_name} requested ${days} day(s) of ${policy.label}.`,
      link: `/leave/${request.id}`,
    });
  }

  await audit.record(req, {
    action: 'leave.create',
    entity: 'LeaveRequest',
    entityId: request.id,
    after: { type: req.body.type, startDate: start, endDate: end, days, status: 'pending' },
  });

  res.status(201).json({ success: true, data: await fetchOne(request.id) });
});

/** GET /api/leave — scope-aware listing. ?scope=mine|team|all */
const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(q);
  const order = SORTS[q.sort] || SORTS['-createdAt'];

  let scopeClause;
  if (q.scope === 'mine' || req.user.role === 'employee') {
    scopeClause = db`and l.employee_id = ${req.user.employee}`;
  } else if (q.employee) {
    const allowed = await scopeService.canAccessEmployee(req.user, q.employee);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
    scopeClause = db`and l.employee_id = ${q.employee}`;
  } else {
    const visible = await scopeService.visibleEmployeeIds(req.user);
    const base = visible === null ? db`` : db`and l.employee_id = any(${visible}::uuid[])`;
    // "team" means my reports, not my own requests.
    scopeClause =
      q.scope === 'team' && req.user.employee
        ? db`${base} and l.employee_id <> ${req.user.employee}`
        : base;
  }

  const where = db`
    where true ${scopeClause}
      ${q.status ? db`and l.status = ${q.status}` : db``}
      ${q.type ? db`and l.type = ${q.type}` : db``}
      ${q.from ? db`and l.start_date >= ${day(q.from)}` : db``}
      ${q.to ? db`and l.start_date <= ${day(q.to)}` : db``}`;

  const [items, [{ count }]] = await Promise.all([
    db`select ${db.unsafe(SELECT)} from leave_requests l join employees e on e.id = l.employee_id
       ${where} order by ${db.unsafe(order)} limit ${limit} offset ${skip}`,
    db`select count(*)::int from leave_requests l ${where}`,
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total: count }) });
});

/** GET /api/leave/pending — the approver's inbox. */
const pending = asyncHandler(async (req, res) => {
  let scopeClause;
  if (req.user.role === 'manager') {
    // Direct and indirect reports, never the manager's own requests.
    const reports = await scopeService.getSubordinateIds(req.user.employee, { includeSelf: false });
    if (!reports.length) return res.json({ success: true, data: [], meta: { total: 0 } });
    scopeClause = db`and l.employee_id = any(${reports}::uuid[])`;
  } else if (req.user.role === 'admin') {
    scopeClause = db``;
  } else {
    throw ApiError.forbidden('Only managers and admins have an approval queue');
  }

  const items = await db`
    select ${db.unsafe(SELECT)} from leave_requests l join employees e on e.id = l.employee_id
    where l.status = 'pending' ${scopeClause} order by l.created_at`;

  res.json({ success: true, data: items, meta: { total: items.length } });
});

/** GET /api/leave/:id */
const getOne = asyncHandler(async (req, res) => {
  const request = await fetchOne(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const allowed = await scopeService.canAccessEmployee(req.user, request.employee._id);
  if (!allowed) throw ApiError.forbidden('This request is outside your scope');

  res.json({ success: true, data: request });
});

/**
 * PATCH /api/leave/:id/decision — the approve/reject transition.
 *
 * Three guards run here: the state machine refuses illegal transitions,
 * canApproveFor refuses anyone who is not the target's manager (or an admin),
 * and self-approval is blocked outright.
 */
const decide = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  const [request] = await db`select * from leave_requests where id = ${req.params.id}`;
  if (!request) throw ApiError.notFound('Leave request not found');

  const canApprove = await scopeService.canApproveFor(req.user, request.employee_id);
  if (!canApprove) {
    await audit.record(req, {
      action: `leave.${decision}`,
      entity: 'LeaveRequest',
      entityId: request.id,
      outcome: 'denied',
    });
    throw ApiError.forbidden('Only an admin or the reporting manager can decide this request');
  }

  assertTransition(request.status, decision);

  await db.begin(async (tx) => {
    await tx`
      update leave_requests
      set status = ${decision}, approved_by = ${req.user._id}, decided_at = now(), decision_note = ${note || null}
      where id = ${request.id}`;
    await tx`
      insert into leave_request_history (request_id, from_status, to_status, by_user, note)
      values (${request.id}, ${request.status}, ${decision}, ${req.user._id}, ${note || null})`;

    if (decision === 'approved') {
      const [policy] = await tx`select is_paid from leave_policies where type = ${request.type}`;
      if (policy?.is_paid) {
        await tx`
          insert into leave_balances (employee_id, type, entitled, used, carried_forward)
          values (${request.employee_id}, ${request.type}, 0, ${request.days}, 0)
          on conflict (employee_id, type)
          do update set used = greatest(0, leave_balances.used + ${request.days})`;
      }

      // Mark the covered working days so the attendance report does not read
      // them as absences.
      const days = eachDay(request.start_date, request.end_date)
        .filter((d) => !isWeekend(d))
        .map(day);
      if (days.length) {
        await tx`
          insert into attendance (employee_id, date, status, source, notes)
          select ${request.employee_id}, d::date, 'on_leave', 'system', ${`${request.type} leave`}
          from unnest(${days}::date[]) as d
          on conflict (employee_id, date) do update
            set status = 'on_leave', source = 'system', notes = excluded.notes`;
      }
    }
  });

  await notify.notifyEmployee(request.employee_id, {
    type: 'leave_decided',
    title: `Leave request ${decision}`,
    message: `Your ${request.type} leave from ${dayjs.utc(request.start_date).format('DD MMM')} was ${decision}.${
      note ? ` Note: ${note}` : ''
    }`,
    link: `/leave/${request.id}`,
  });

  await audit.record(req, {
    action: `leave.${decision}`,
    entity: 'LeaveRequest',
    entityId: request.id,
    before: { status: request.status },
    after: { status: decision, decisionNote: note || null },
  });

  res.json({ success: true, data: await fetchOne(request.id) });
});

/**
 * PATCH /api/leave/:id/cancel
 * The requester may withdraw their own request; cancelling an already-approved one
 * releases the consumed balance and clears the attendance markers.
 */
const cancel = asyncHandler(async (req, res) => {
  const [request] = await db`select * from leave_requests where id = ${req.params.id}`;
  if (!request) throw ApiError.notFound('Leave request not found');

  const isOwner = String(request.employee_id) === String(req.user.employee);
  if (!isOwner && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only the requester or an admin can cancel this');
  }

  assertTransition(request.status, 'cancelled');
  const wasApproved = request.status === 'approved';

  await db.begin(async (tx) => {
    await tx`update leave_requests set status = 'cancelled' where id = ${request.id}`;
    await tx`
      insert into leave_request_history (request_id, from_status, to_status, by_user, note)
      values (${request.id}, ${request.status}, 'cancelled', ${req.user._id}, ${req.body?.note || 'Cancelled'})`;

    if (wasApproved) {
      const [policy] = await tx`select is_paid from leave_policies where type = ${request.type}`;
      if (policy?.is_paid) {
        await tx`
          update leave_balances set used = greatest(0, used - ${request.days})
          where employee_id = ${request.employee_id} and type = ${request.type}`;
      }
      await tx`
        delete from attendance
        where employee_id = ${request.employee_id}
          and date between ${request.start_date} and ${request.end_date}
          and status = 'on_leave' and source = 'system'`;
    }
  });

  await audit.record(req, {
    action: 'leave.cancel',
    entity: 'LeaveRequest',
    entityId: request.id,
    before: { status: request.status },
    after: { status: 'cancelled' },
  });

  res.json({ success: true, data: await fetchOne(request.id) });
});

/** GET /api/leave/balance — remaining entitlement per leave type. */
const balance = asyncHandler(async (req, res) => {
  const employeeId = req.query.employee || req.user.employee;
  if (!employeeId) throw ApiError.badRequest('No employee record is linked to your account');
  const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
  if (!allowed) throw ApiError.forbidden('This employee is outside your scope');

  res.json({ success: true, data: await leaveService.balanceSummary(employeeId) });
});

/** GET /api/leave/calendar — who is away in a date window. */
const calendar = asyncHandler(async (req, res) => {
  const from = day(req.query.from || dayjs.utc().startOf('month'));
  const to = day(req.query.to || dayjs.utc().endOf('month'));
  const visible = await scopeService.visibleEmployeeIds(req.user);

  const data = await db`
    select l.id as "_id", l.type, l.days::float8 as days,
           to_char(l.start_date, 'YYYY-MM-DD') as "startDate",
           to_char(l.end_date, 'YYYY-MM-DD')   as "endDate",
           ${db.unsafe(employeeMini('e'))} as "employee"
    from leave_requests l join employees e on e.id = l.employee_id
    where l.status = 'approved' and l.start_date <= ${to} and l.end_date >= ${from}
      ${visible === null ? db`` : db`and l.employee_id = any(${visible}::uuid[])`}
    order by l.start_date`;

  res.json({ success: true, data });
});

module.exports = { create, list, pending, getOne, decide, cancel, balance, calendar };
