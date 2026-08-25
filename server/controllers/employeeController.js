'use strict';
const { Employee, User, Department, LeavePolicy } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const { redactEmployee, redactEmployees } = require('../middleware/roleCheck');
const { parsePagination, parseSort, escapeRegex, buildMeta } = require('../utils/query');
const { toCSV } = require('../utils/csv');

const SORTABLE = ['firstName', 'lastName', 'hireDate', 'jobTitle', 'status', 'createdAt', 'employeeCode'];
const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'manager', select: 'firstName lastName jobTitle employeeCode' },
];

/** Next sequential employee code, e.g. EMP-0042. */
async function nextEmployeeCode() {
  const last = await Employee.findOne({}).sort({ createdAt: -1 }).select('employeeCode').lean();
  const n = last?.employeeCode?.match(/(\d+)$/) ? Number(last.employeeCode.match(/(\d+)$/)[1]) + 1 : 1;
  return `EMP-${String(n).padStart(4, '0')}`;
}

/** Default leave buckets seeded from the active policies when an employee is created. */
async function initialLeaveBalances() {
  const policies = await LeavePolicy.find({ isActive: true }).lean();
  return policies.map((p) => ({ type: p.type, entitled: p.annualQuota, used: 0, carriedForward: 0 }));
}

/**
 * Builds the Mongo filter for a list request, intersecting the caller's visibility
 * scope with whatever they asked for. A manager who passes ?department=<other team>
 * still only ever gets their own sub-tree back.
 */
async function buildListFilter(req, query) {
  const filter = query.includeDeleted && req.user.role === 'admin' ? {} : { deletedAt: null };

  const visible = await scopeService.visibleEmployeeIds(req.user);
  if (visible !== null) filter._id = { $in: visible };

  if (query.department) filter.department = query.department;
  if (query.status) filter.status = query.status;
  if (query.employmentType) filter.employmentType = query.employmentType;
  if (query.manager) filter.manager = query.manager;

  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [
      { firstName: rx },
      { lastName: rx },
      { workEmail: rx },
      { jobTitle: rx },
      { employeeCode: rx },
    ];
  }
  return filter;
}

/** GET /api/employees — search, filter, sort, paginate. */
const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, SORTABLE, { createdAt: -1 });
  const filter = await buildListFilter(req, query);

  const [items, total] = await Promise.all([
    Employee.find(filter).populate(POPULATE).sort(sort).skip(skip).limit(limit).lean(),
    Employee.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: redactEmployees(items, req.user),
    meta: buildMeta({ page, limit, total }),
  });
});

/** GET /api/employees/export — same filter as the list, streamed as CSV. */
const exportCsv = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || req.query;
  const filter = await buildListFilter(req, query);
  const rows = await Employee.find(filter).populate(POPULATE).sort({ employeeCode: 1 }).lean();

  const columns = [
    { key: 'employeeCode', header: 'Employee Code' },
    { key: 'firstName', header: 'First Name' },
    { key: 'lastName', header: 'Last Name' },
    { key: 'workEmail', header: 'Work Email' },
    { key: 'jobTitle', header: 'Job Title' },
    { header: 'Department', map: (r) => r.department?.name || '' },
    { header: 'Manager', map: (r) => (r.manager ? `${r.manager.firstName} ${r.manager.lastName}` : '') },
    { key: 'employmentType', header: 'Employment Type' },
    { key: 'status', header: 'Status' },
    { header: 'Hire Date', map: (r) => new Date(r.hireDate).toISOString().slice(0, 10) },
  ];
  // Salary only leaves the building for admins.
  if (req.user.role === 'admin') columns.push({ key: 'salary', header: 'Salary' });

  await audit.record(req, { action: 'employee.export', entity: 'Employee' });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="employees-${Date.now()}.csv"`);
  res.send(toCSV(rows, columns));
});

/** GET /api/employees/:id */
const getOne = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id).populate(POPULATE).lean();
  if (!employee || (employee.deletedAt && req.user.role !== 'admin')) {
    throw ApiError.notFound('Employee not found');
  }
  const [directReports, account] = await Promise.all([
    Employee.find({ manager: employee._id, deletedAt: null })
      .select('firstName lastName jobTitle avatarUrl employeeCode')
      .lean(),
    User.findOne({ employee: employee._id }).select('email role isActive lastLoginAt').lean(),
  ]);

  res.json({
    success: true,
    data: { ...redactEmployee(employee, req.user), directReports, account },
  });
});

/** POST /api/employees — admin only. Optionally provisions the login account too. */
const create = asyncHandler(async (req, res) => {
  const { createAccount, accountRole, accountPassword, ...payload } = req.body;

  if (payload.manager) {
    const manager = await Employee.findById(payload.manager).lean();
    if (!manager) throw ApiError.badRequest('Manager does not exist');
  }
  if (payload.department) {
    const dept = await Department.findById(payload.department).lean();
    if (!dept) throw ApiError.badRequest('Department does not exist');
  }

  const employee = await Employee.create({
    ...payload,
    employeeCode: payload.employeeCode || (await nextEmployeeCode()),
    leaveBalances: await initialLeaveBalances(),
  });

  let account = null;
  if (createAccount) {
    if (!accountPassword) throw ApiError.badRequest('accountPassword is required to create a login');
    const user = new User({
      email: employee.workEmail,
      role: accountRole || 'employee',
      employee: employee._id,
    });
    await user.setPassword(accountPassword);
    await user.save();
    account = { id: user._id, email: user.email, role: user.role };
  }

  await audit.record(req, {
    action: 'employee.create',
    entity: 'Employee',
    entityId: employee._id,
    after: employee.toObject(),
  });

  res.status(201).json({ success: true, data: { ...redactEmployee(employee, req.user), account } });
});

/**
 * PATCH /api/employees/:id
 * Admins may edit anything. A manager may edit non-sensitive job fields for someone
 * in their tree; an employee may edit only their own contact details.
 */
const MANAGER_EDITABLE = ['jobTitle', 'location', 'phone', 'status', 'employmentType', 'avatarUrl'];
const SELF_EDITABLE = ['phone', 'location', 'avatarUrl'];

const update = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');

  let allowed = Object.keys(req.body);
  if (req.user.role === 'manager') {
    const isSelf = String(employee._id) === String(req.user.employee);
    allowed = allowed.filter((f) => (isSelf ? SELF_EDITABLE : MANAGER_EDITABLE).includes(f));
  } else if (req.user.role === 'employee') {
    allowed = allowed.filter((f) => SELF_EDITABLE.includes(f));
  }

  const rejected = Object.keys(req.body).filter((f) => !allowed.includes(f));
  if (!allowed.length) {
    throw ApiError.forbidden(`Your role cannot change: ${rejected.join(', ')}`);
  }

  if (req.body.manager && String(req.body.manager) === String(employee._id)) {
    throw ApiError.badRequest('An employee cannot report to themselves');
  }
  // Reassigning a manager must not create a reporting cycle.
  if (req.body.manager) {
    const subtree = await scopeService.getSubordinateIds(employee._id, { includeSelf: false });
    if (subtree.some((id) => String(id) === String(req.body.manager))) {
      throw ApiError.badRequest('That change would create a reporting loop');
    }
  }

  const before = employee.toObject();
  allowed.forEach((field) => {
    employee[field] = req.body[field];
  });
  if (employee.status === 'terminated' && !employee.terminatedAt) employee.terminatedAt = new Date();
  await employee.save();

  await audit.record(req, {
    action: 'employee.update',
    entity: 'Employee',
    entityId: employee._id,
    before,
    after: employee.toObject(),
  });

  res.json({
    success: true,
    data: redactEmployee(employee, req.user),
    ...(rejected.length ? { ignoredFields: rejected } : {}),
  });
});

/**
 * DELETE /api/employees/:id — soft delete.
 * The record is flagged, the login is disabled and direct reports are re-pointed at
 * the departing employee's own manager. Attendance, leave and review history stay
 * intact, which is the whole reason this is not a hard delete.
 */
const deactivate = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');
  if (String(employee._id) === String(req.user.employee)) {
    throw ApiError.badRequest('You cannot deactivate your own record');
  }

  const before = employee.toObject();
  employee.deletedAt = new Date();
  employee.status = 'terminated';
  employee.terminatedAt = employee.terminatedAt || new Date();
  await employee.save();

  const [reassigned] = await Promise.all([
    Employee.updateMany({ manager: employee._id }, { manager: employee.manager }),
    User.updateOne({ employee: employee._id }, { isActive: false, $inc: { tokenVersion: 1 } }),
  ]);

  await audit.record(req, {
    action: 'employee.deactivate',
    entity: 'Employee',
    entityId: employee._id,
    before,
    after: employee.toObject(),
  });

  res.json({
    success: true,
    message: 'Employee deactivated; history preserved',
    data: { reportsReassigned: reassigned.modifiedCount },
  });
});

/** POST /api/employees/:id/restore — admin undo for a soft delete. */
const restore = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!employee.deletedAt) throw ApiError.badRequest('Employee is already active');

  employee.deletedAt = null;
  employee.status = 'active';
  employee.terminatedAt = undefined;
  await employee.save();
  await User.updateOne({ employee: employee._id }, { isActive: true });

  await audit.record(req, { action: 'employee.restore', entity: 'Employee', entityId: employee._id });
  res.json({ success: true, data: redactEmployee(employee, req.user) });
});

/** PATCH /api/employees/:id/manager — admin reassignment with cycle protection. */
const assignManager = asyncHandler(async (req, res) => {
  const { manager } = req.body;
  const employee = await Employee.findById(req.params.id);
  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');

  if (manager) {
    if (String(manager) === String(employee._id)) {
      throw ApiError.badRequest('An employee cannot report to themselves');
    }
    const target = await Employee.findById(manager).lean();
    if (!target || target.deletedAt) throw ApiError.badRequest('Manager does not exist');
    const subtree = await scopeService.getSubordinateIds(employee._id, { includeSelf: false });
    if (subtree.some((id) => String(id) === String(manager))) {
      throw ApiError.badRequest('That change would create a reporting loop');
    }
  }

  const before = { manager: employee.manager };
  employee.manager = manager || null;
  await employee.save();

  await audit.record(req, {
    action: 'employee.assign_manager',
    entity: 'Employee',
    entityId: employee._id,
    before,
    after: { manager: employee.manager },
  });

  res.json({ success: true, data: redactEmployee(employee, req.user) });
});

/** GET /api/employees/:id/team — direct reports of one employee. */
const team = asyncHandler(async (req, res) => {
  const reports = await Employee.find({ manager: req.params.id, deletedAt: null })
    .populate(POPULATE)
    .lean();
  res.json({ success: true, data: redactEmployees(reports, req.user) });
});

/** GET /api/employees/org-chart — recursive tree built with $graphLookup. */
const orgChart = asyncHandler(async (req, res) => {
  // A manager gets their own sub-tree; admins get every root.
  const root = req.user.role === 'manager' ? req.user.employee : req.query.root || null;
  if (req.user.role === 'employee') throw ApiError.forbidden('Org chart is available to managers and admins');
  const tree = await reportService.orgChart(root);
  res.json({ success: true, data: tree });
});

/** GET /api/employees/lookup — light list for dropdowns (id + name only). */
const lookup = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null, status: { $ne: 'terminated' } };
  const visible = await scopeService.visibleEmployeeIds(req.user);
  if (visible !== null) filter._id = { $in: visible };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { employeeCode: rx }];
  }
  const rows = await Employee.find(filter)
    .select('firstName lastName jobTitle employeeCode')
    .sort({ firstName: 1 })
    .limit(50)
    .lean();
  res.json({
    success: true,
    data: rows.map((r) => ({
      _id: r._id,
      name: `${r.firstName} ${r.lastName}`,
      jobTitle: r.jobTitle,
      employeeCode: r.employeeCode,
    })),
  });
});

module.exports = {
  list,
  getOne,
  create,
  update,
  deactivate,
  restore,
  assignManager,
  team,
  orgChart,
  lookup,
  exportCsv,
};

