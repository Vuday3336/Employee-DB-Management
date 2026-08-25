'use strict';
const { LeaveRequest, Employee, Attendance, LeavePolicy } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const leaveService = require('../services/leaveService');
const scopeService = require('../services/scopeService');
const notify = require('../services/notificationService');
const { parsePagination, parseSort, buildMeta } = require('../utils/query');
const { startOfDay, endOfDay, eachDay, isWeekend, dayjs } = require('../utils/dates');

const SORTABLE = ['startDate', 'endDate', 'createdAt', 'status', 'days'];
const POPULATE = [
  { path: 'employee', select: 'firstName lastName employeeCode jobTitle avatarUrl manager' },
  { path: 'approvedBy', select: 'email role' },
];

/**
 * POST /api/leave
 * An employee files for themselves. Admins and managers may file on behalf of
 * someone inside their scope. Every rule (overlap, notice, quota, balance) runs
 * server-side in leaveService before the request is persisted.
 */
const create = asyncHandler(async (req, res) => {
  const employeeId = req.body.employee || req.user.employee;
  if (!employeeId) throw ApiError.badRequest('No employee record is linked to your account');

  if (String(employeeId) !== String(req.user.employee)) {
    if (req.user.role === 'employee') throw ApiError.forbidden('You can only file leave for yourself');
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
  }

  const employee = await Employee.findById(employeeId);
  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');

  const start = startOfDay(req.body.startDate);
  const end = startOfDay(req.body.endDate);

  await leaveService.assertNoOverlap(employeeId, start, end);
  const days = await leaveService.computeDays(start, end, req.body.halfDay);
  const policy = await leaveService.assertPolicy(employee, req.body.type, start, days);

  if (policy.requiresAttachment && !req.body.attachmentUrl) {
    throw ApiError.badRequest(`${policy.label} requires a supporting document`);
  }

  const request = await LeaveRequest.create({
    employee: employeeId,
    type: req.body.type,
    startDate: start,
    endDate: end,
    days,
    halfDay: Boolean(req.body.halfDay),
    reason: req.body.reason,
    attachmentUrl: req.body.attachmentUrl,
    status: 'pending',
    history: [{ from: null, to: 'pending', by: req.user._id, note: 'Request submitted' }],
  });

  // Ping whoever has to act on it.
  if (employee.manager) {
    await notify.notifyEmployee(employee.manager, {
      type: 'leave_submitted',
      title: 'Leave request awaiting your approval',
      message: `${employee.firstName} ${employee.lastName} requested ${days} day(s) of ${policy.label}.`,
      link: `/leave/${request._id}`,
    });
  }

  await audit.record(req, {
    action: 'leave.create',
    entity: 'LeaveRequest',
    entityId: request._id,
    after: request.toObject(),
  });

  res.status(201).json({ success: true, data: await request.populate(POPULATE) });
});

/** GET /api/leave — scope-aware listing. ?scope=mine|team|all */
const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { createdAt: -1 });

  const filter = {};
  if (query.scope === 'mine' || req.user.role === 'employee') {
    filter.employee = req.user.employee;
  } else if (query.employee) {
    const allowed = await scopeService.canAccessEmployee(req.user, query.employee);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
    filter.employee = query.employee;
  } else {
    Object.assign(filter, await scopeService.scopeFilter(req.user, 'employee'));
    // "team" means my reports, not my own requests.
    if (query.scope === 'team' && req.user.employee) {
      filter.employee = { ...(filter.employee || {}), $ne: req.user.employee };
    }
  }

  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;
  if (query.from || query.to) {
    filter.startDate = {};
    if (query.from) filter.startDate.$gte = startOfDay(query.from);
    if (query.to) filter.startDate.$lte = endOfDay(query.to);
  }

  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    LeaveRequest.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total }) });
});

/** GET /api/leave/pending — the approver's inbox. */
const pending = asyncHandler(async (req, res) => {
  const filter = { status: 'pending' };
  if (req.user.role === 'manager') {
    const reports = await scopeService.getSubordinateIds(req.user.employee, { includeSelf: false });
    filter.employee = { $in: reports };
  } else if (req.user.role !== 'admin') {
    throw ApiError.forbidden('Only managers and admins have an approval queue');
  }

  const items = await LeaveRequest.find(filter).populate(POPULATE).sort({ createdAt: 1 }).lean();
  res.json({ success: true, data: items, meta: { total: items.length } });
});

/** GET /api/leave/:id */
const getOne = asyncHandler(async (req, res) => {
  const request = await LeaveRequest.findById(req.params.id).populate(POPULATE).lean();
  if (!request) throw ApiError.notFound('Leave request not found');

  const allowed = await scopeService.canAccessEmployee(req.user, request.employee._id || request.employee);
  if (!allowed) throw ApiError.forbidden('This request is outside your scope');

  res.json({ success: true, data: request });
});

/**
 * PATCH /api/leave/:id/decision — the approve/reject transition.
 *
 * Three separate guards run here: the state machine refuses illegal transitions,
 * scopeService.canApproveFor refuses anyone who is not the target's manager (or an
 * admin), and self-approval is blocked outright.
 */
const decide = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const canApprove = await scopeService.canApproveFor(req.user, request.employee);
  if (!canApprove) {
    await audit.record(req, {
      action: `leave.${decision}`,
      entity: 'LeaveRequest',
      entityId: request._id,
      outcome: 'denied',
    });
    throw ApiError.forbidden('Only an admin or the reporting manager can decide this request');
  }

  const before = request.toObject();
  request.transition(decision, { by: req.user._id, note }); // throws 409 on an illegal move

  if (decision === 'approved') {
    const policy = await LeavePolicy.findOne({ type: request.type }).lean();
    if (policy?.isPaid) {
      await leaveService.applyBalance(request.employee, request.type, request.days);
    }
    // Mark the covered working days so the attendance report does not read them as absences.
    const days = eachDay(request.startDate, request.endDate).filter((d) => !isWeekend(d));
    await Attendance.bulkWrite(
      days.map((date) => ({
        updateOne: {
          filter: { employee: request.employee, date },
          update: {
            $set: {
              employee: request.employee,
              date,
              status: 'on_leave',
              source: 'system',
              notes: `${request.type} leave`,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  await request.save();

  await notify.notifyEmployee(request.employee, {
    type: 'leave_decided',
    title: `Leave request ${decision}`,
    message: `Your ${request.type} leave from ${dayjs.utc(request.startDate).format('DD MMM')} was ${decision}.${
      note ? ` Note: ${note}` : ''
    }`,
    link: `/leave/${request._id}`,
  });

  await audit.record(req, {
    action: `leave.${decision}`,
    entity: 'LeaveRequest',
    entityId: request._id,
    before,
    after: request.toObject(),
  });

  res.json({ success: true, data: await request.populate(POPULATE) });
});

/**
 * PATCH /api/leave/:id/cancel
 * The requester may withdraw their own pending request; cancelling an already
 * approved one releases the consumed balance and clears the attendance markers.
 */
const cancel = asyncHandler(async (req, res) => {
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Leave request not found');

  const isOwner = String(request.employee) === String(req.user.employee);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Only the requester or an admin can cancel this');

  const wasApproved = request.status === 'approved';
  const before = request.toObject();
  request.transition('cancelled', { by: req.user._id, note: req.body?.note || 'Cancelled' });

  if (wasApproved) {
    const policy = await LeavePolicy.findOne({ type: request.type }).lean();
    if (policy?.isPaid) {
      await leaveService.applyBalance(request.employee, request.type, -request.days);
    }
    await Attendance.deleteMany({
      employee: request.employee,
      date: { $gte: request.startDate, $lte: request.endDate },
      status: 'on_leave',
      source: 'system',
    });
  }

  await request.save();

  await audit.record(req, {
    action: 'leave.cancel',
    entity: 'LeaveRequest',
    entityId: request._id,
    before,
    after: request.toObject(),
  });

  res.json({ success: true, data: await request.populate(POPULATE) });
});

/** GET /api/leave/balance — remaining entitlement per leave type. */
const balance = asyncHandler(async (req, res) => {
  const employeeId = req.query.employee || req.user.employee;
  if (!employeeId) throw ApiError.badRequest('No employee record is linked to your account');
  const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
  if (!allowed) throw ApiError.forbidden('This employee is outside your scope');

  const data = await leaveService.balanceSummary(employeeId);
  res.json({ success: true, data });
});

/** GET /api/leave/calendar — who is away in a date window, for the team view. */
const calendar = asyncHandler(async (req, res) => {
  const from = startOfDay(req.query.from || dayjs.utc().startOf('month').toDate());
  const to = endOfDay(req.query.to || dayjs.utc().endOf('month').toDate());

  const filter = {
    status: 'approved',
    startDate: { $lte: to },
    endDate: { $gte: from },
    ...(await scopeService.scopeFilter(req.user, 'employee')),
  };

  const items = await LeaveRequest.find(filter)
    .populate('employee', 'firstName lastName avatarUrl jobTitle')
    .lean();

  res.json({
    success: true,
    data: items.map((r) => ({
      _id: r._id,
      type: r.type,
      days: r.days,
      startDate: dayjs.utc(r.startDate).format('YYYY-MM-DD'),
      endDate: dayjs.utc(r.endDate).format('YYYY-MM-DD'),
      employee: r.employee,
    })),
  });
});

module.exports = { create, list, pending, getOne, decide, cancel, balance, calendar };
