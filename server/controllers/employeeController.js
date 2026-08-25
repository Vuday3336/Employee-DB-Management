'use strict';
const { db } = require('../db');
const { EMPLOYEE_FULL, EMPLOYEE_JOINS } = require('../db/shapes');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const reportService = require('../services/reportService');
const { hash } = require('./authController');
const { redactEmployee, redactEmployees } = require('../middleware/roleCheck');
const { parsePagination, buildMeta } = require('../utils/query');
const { toCSV } = require('../utils/csv');

/** ?sort= is mapped through this allow-list; anything else falls back to newest first. */
const SORTS = {
  firstName: 'e.first_name asc',
  '-firstName': 'e.first_name desc',
  lastName: 'e.last_name asc',
  '-lastName': 'e.last_name desc',
  hireDate: 'e.hire_date asc',
  '-hireDate': 'e.hire_date desc',
  jobTitle: 'e.job_title asc',
  '-jobTitle': 'e.job_title desc',
  status: 'e.status asc',
  '-status': 'e.status desc',
  employeeCode: 'e.employee_code asc',
  '-employeeCode': 'e.employee_code desc',
  createdAt: 'e.created_at asc',
  '-createdAt': 'e.created_at desc',
};

/** Next sequential employee code, e.g. EMP-0042. */
async function nextEmployeeCode() {
  const [row] = await db`
    select coalesce(max(nullif(regexp_replace(employee_code, '\\D', '', 'g'), '')::int), 0) + 1 as next
    from employees`;
  return `EMP-${String(row.next).padStart(4, '0')}`;
}

/**
 * Builds the WHERE clause for a list request, intersecting the caller's visibility
 * scope with whatever they asked for. A manager who passes ?department=<other team>
 * still only ever gets their own sub-tree back.
 */
async function listWhere(req, q) {
  const visible = await scopeService.visibleEmployeeIds(req.user);
  const includeDeleted = q.includeDeleted && req.user.role === 'admin';

  return db`
    where true
      ${includeDeleted ? db`` : db`and e.deleted_at is null`}
      ${visible === null ? db`` : db`and e.id = any(${visible}::uuid[])`}
      ${q.department ? db`and e.department_id = ${q.department}` : db``}
      ${q.status ? db`and e.status = ${q.status}` : db``}
      ${q.employmentType ? db`and e.employment_type = ${q.employmentType}` : db``}
      ${q.manager ? db`and e.manager_id = ${q.manager}` : db``}
      ${
        q.q
          ? db`and (e.first_name || ' ' || e.last_name || ' ' || e.work_email || ' ' ||
                    e.job_title || ' ' || e.employee_code) ilike ${'%' + q.q + '%'}`
          : db``
      }`;
}

/** GET /api/employees — search, filter, sort, paginate. */
const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(q);
  const where = await listWhere(req, q);
  const order = SORTS[q.sort] || SORTS['-createdAt'];

  const [items, [{ count }]] = await Promise.all([
    db`select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} ${where}
       order by ${db.unsafe(order)} limit ${limit} offset ${skip}`,
    db`select count(*)::int from employees e ${where}`,
  ]);

  res.json({
    success: true,
    data: redactEmployees(items, req.user),
    meta: buildMeta({ page, limit, total: count }),
  });
});

/** GET /api/employees/export — same filter as the list, streamed as CSV. */
const exportCsv = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const where = await listWhere(req, q);
  const rows = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} ${where}
    order by e.employee_code`;

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
  const [employee] = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)}
    where e.id = ${req.params.id}`;
  if (!employee || (employee.deletedAt && req.user.role !== 'admin')) {
    throw ApiError.notFound('Employee not found');
  }

  const [directReports, [account]] = await Promise.all([
    db`select e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
              e.job_title as "jobTitle", e.avatar_url as "avatarUrl", e.employee_code as "employeeCode"
       from employees e where e.manager_id = ${employee._id} and e.deleted_at is null
       order by e.first_name`,
    db`select id as "_id", email, role, is_active as "isActive", last_login_at as "lastLoginAt"
       from users where employee_id = ${employee._id}`,
  ]);

  res.json({
    success: true,
    data: { ...redactEmployee(employee, req.user), directReports, account: account || null },
  });
});

/** POST /api/employees — admin only. Optionally provisions the login account too. */
const create = asyncHandler(async (req, res) => {
  const { createAccount, accountRole, accountPassword, ...p } = req.body;

  if (p.manager) {
    const [m] = await db`select id from employees where id = ${p.manager} and deleted_at is null`;
    if (!m) throw ApiError.badRequest('Manager does not exist');
  }
  if (p.department) {
    const [d] = await db`select id from departments where id = ${p.department}`;
    if (!d) throw ApiError.badRequest('Department does not exist');
  }
  if (createAccount && !accountPassword) {
    throw ApiError.badRequest('accountPassword is required to create a login');
  }

  const code = p.employeeCode || (await nextEmployeeCode());

  // One transaction: the employee, their opening leave balances, and optionally
  // the login account either all land or none do.
  const { employee, account } = await db.begin(async (tx) => {
    const [row] = await tx`
      insert into employees (employee_code, first_name, last_name, work_email, phone, department_id,
                             job_title, manager_id, hire_date, employment_type, status, salary, location, avatar_url)
      values (${code}, ${p.firstName}, ${p.lastName}, ${p.workEmail}, ${p.phone || null},
              ${p.department || null}, ${p.jobTitle}, ${p.manager || null}, ${p.hireDate},
              ${p.employmentType || 'full_time'}, ${p.status || 'active'}, ${p.salary ?? 0},
              ${p.location || null}, ${p.avatarUrl || null})
      returning *`;

    await tx`
      insert into leave_balances (employee_id, type, entitled, used, carried_forward)
      select ${row.id}, type, annual_quota, 0, 0 from leave_policies where is_active = true`;

    let created = null;
    if (createAccount) {
      const [u] = await tx`
        insert into users (email, password_hash, role, employee_id)
        values (${row.work_email}, ${await hash(accountPassword)}, ${accountRole || 'employee'}, ${row.id})
        returning id, email, role`;
      created = u;
    }
    return { employee: row, account: created };
  });

  const [full] = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} where e.id = ${employee.id}`;

  await audit.record(req, {
    action: 'employee.create',
    entity: 'Employee',
    entityId: employee.id,
    after: { employeeCode: code, workEmail: p.workEmail, jobTitle: p.jobTitle },
  });

  res.status(201).json({ success: true, data: { ...redactEmployee(full, req.user), account } });
});

/**
 * PATCH /api/employees/:id
 * Admins may edit anything. A manager may edit non-sensitive job fields for someone
 * in their tree; an employee may edit only their own contact details.
 */
const MANAGER_EDITABLE = ['jobTitle', 'location', 'phone', 'status', 'employmentType', 'avatarUrl'];
const SELF_EDITABLE = ['phone', 'location', 'avatarUrl'];
const COLUMN = {
  firstName: 'first_name',
  lastName: 'last_name',
  workEmail: 'work_email',
  phone: 'phone',
  department: 'department_id',
  jobTitle: 'job_title',
  hireDate: 'hire_date',
  employmentType: 'employment_type',
  status: 'status',
  salary: 'salary',
  location: 'location',
  avatarUrl: 'avatar_url',
};

const update = asyncHandler(async (req, res) => {
  const [employee] = await db`select * from employees where id = ${req.params.id}`;
  if (!employee || employee.deleted_at) throw ApiError.notFound('Employee not found');

  let allowed = Object.keys(req.body).filter((f) => COLUMN[f]);
  if (req.user.role === 'manager') {
    const isSelf = String(employee.id) === String(req.user.employee);
    allowed = allowed.filter((f) => (isSelf ? SELF_EDITABLE : MANAGER_EDITABLE).includes(f));
  } else if (req.user.role === 'employee') {
    allowed = allowed.filter((f) => SELF_EDITABLE.includes(f));
  }

  const rejected = Object.keys(req.body).filter((f) => !allowed.includes(f));
  if (!allowed.length) throw ApiError.forbidden(`Your role cannot change: ${rejected.join(', ')}`);

  const patch = {};
  allowed.forEach((f) => {
    patch[COLUMN[f]] = req.body[f];
  });
  if (patch.status === 'terminated' && !employee.terminated_at) patch.terminated_at = new Date();

  const before = Object.fromEntries(allowed.map((f) => [f, employee[COLUMN[f]]]));
  await db`update employees set ${db(patch)} where id = ${employee.id}`;

  const [full] = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} where e.id = ${employee.id}`;

  await audit.record(req, {
    action: 'employee.update',
    entity: 'Employee',
    entityId: employee.id,
    before,
    after: Object.fromEntries(allowed.map((f) => [f, req.body[f]])),
  });

  res.json({
    success: true,
    data: redactEmployee(full, req.user),
    ...(rejected.length ? { ignoredFields: rejected } : {}),
  });
});

/**
 * DELETE /api/employees/:id — soft delete.
 * The record is flagged, the login disabled and direct reports re-pointed at the
 * departing employee's own manager. Attendance, leave and review history stay
 * intact, which is the whole reason this is not a hard delete.
 */
const deactivate = asyncHandler(async (req, res) => {
  const [employee] = await db`select * from employees where id = ${req.params.id}`;
  if (!employee || employee.deleted_at) throw ApiError.notFound('Employee not found');
  if (String(employee.id) === String(req.user.employee)) {
    throw ApiError.badRequest('You cannot deactivate your own record');
  }

  const reassigned = await db.begin(async (tx) => {
    await tx`
      update employees
      set deleted_at = now(), status = 'terminated', terminated_at = coalesce(terminated_at, now())
      where id = ${employee.id}`;
    const moved = await tx`
      update employees set manager_id = ${employee.manager_id} where manager_id = ${employee.id} returning id`;
    await tx`
      update users set is_active = false, token_version = token_version + 1
      where employee_id = ${employee.id}`;
    return moved.length;
  });

  await audit.record(req, {
    action: 'employee.deactivate',
    entity: 'Employee',
    entityId: employee.id,
    before: { status: employee.status, deletedAt: null },
    after: { status: 'terminated', deletedAt: 'set' },
  });

  res.json({
    success: true,
    message: 'Employee deactivated; history preserved',
    data: { reportsReassigned: reassigned },
  });
});

/** POST /api/employees/:id/restore — admin undo for a soft delete. */
const restore = asyncHandler(async (req, res) => {
  const [employee] = await db`select * from employees where id = ${req.params.id}`;
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!employee.deleted_at) throw ApiError.badRequest('Employee is already active');

  await db.begin(async (tx) => {
    await tx`
      update employees set deleted_at = null, status = 'active', terminated_at = null
      where id = ${employee.id}`;
    await tx`update users set is_active = true where employee_id = ${employee.id}`;
  });

  const [full] = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} where e.id = ${employee.id}`;

  await audit.record(req, { action: 'employee.restore', entity: 'Employee', entityId: employee.id });
  res.json({ success: true, data: redactEmployee(full, req.user) });
});

/** PATCH /api/employees/:id/manager — admin reassignment with cycle protection. */
const assignManager = asyncHandler(async (req, res) => {
  const { manager } = req.body;
  const [employee] = await db`select * from employees where id = ${req.params.id}`;
  if (!employee || employee.deleted_at) throw ApiError.notFound('Employee not found');

  if (manager) {
    if (String(manager) === String(employee.id)) {
      throw ApiError.badRequest('An employee cannot report to themselves');
    }
    const [target] = await db`select id from employees where id = ${manager} and deleted_at is null`;
    if (!target) throw ApiError.badRequest('Manager does not exist');

    // Moving someone under their own subordinate would close a loop in the tree.
    const subtree = await scopeService.getSubordinateIds(employee.id, { includeSelf: false });
    if (subtree.some((id) => String(id) === String(manager))) {
      throw ApiError.badRequest('That change would create a reporting loop');
    }
  }

  await db`update employees set manager_id = ${manager || null} where id = ${employee.id}`;
  const [full] = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)} where e.id = ${employee.id}`;

  await audit.record(req, {
    action: 'employee.assign_manager',
    entity: 'Employee',
    entityId: employee.id,
    before: { manager: employee.manager_id },
    after: { manager: manager || null },
  });

  res.json({ success: true, data: redactEmployee(full, req.user) });
});

/** GET /api/employees/:id/team — direct reports of one employee. */
const team = asyncHandler(async (req, res) => {
  const rows = await db`
    select ${db.unsafe(EMPLOYEE_FULL)} from employees e ${db.unsafe(EMPLOYEE_JOINS)}
    where e.manager_id = ${req.params.id} and e.deleted_at is null
    order by e.first_name`;
  res.json({ success: true, data: redactEmployees(rows, req.user) });
});

/** GET /api/employees/org-chart — the reporting tree. */
const orgChart = asyncHandler(async (req, res) => {
  if (req.user.role === 'employee') {
    throw ApiError.forbidden('Org chart is available to managers and admins');
  }
  // A manager gets their own sub-tree; an admin gets every root.
  const root = req.user.role === 'manager' ? req.user.employee : req.query.root || null;
  res.json({ success: true, data: await reportService.orgChart(root) });
});

/** GET /api/employees/lookup — light list for dropdowns. */
const lookup = asyncHandler(async (req, res) => {
  const visible = await scopeService.visibleEmployeeIds(req.user);
  const rows = await db`
    select e.id as "_id", e.first_name || ' ' || e.last_name as name,
           e.job_title as "jobTitle", e.employee_code as "employeeCode"
    from employees e
    where e.deleted_at is null and e.status <> 'terminated'
      ${visible === null ? db`` : db`and e.id = any(${visible}::uuid[])`}
      ${req.query.q ? db`and (e.first_name || ' ' || e.last_name || ' ' || e.employee_code) ilike ${'%' + req.query.q + '%'}` : db``}
    order by e.first_name
    limit 100`;
  res.json({ success: true, data: rows });
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
  nextEmployeeCode,
};

