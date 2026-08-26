'use strict';
const { db, noFilter } = require('../db');
const { employeeMini } = require('../db/shapes');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');

const SELECT = `
  d.id           as "_id",
  d.name         as "name",
  d.code         as "code",
  d.description  as "description",
  d.cost_center  as "costCenter",
  d.is_active    as "isActive",
  ${employeeMini('m')} as "manager",
  (select count(*)::int from employees x
   where x.department_id = d.id and x.deleted_at is null and x.status <> 'terminated') as "headcount"
`;

/** GET /api/departments — with live headcount. */
const list = asyncHandler(async (req, res) => {
  const data = await db`
    select ${db.unsafe(SELECT)}
    from departments d left join employees m on m.id = d.manager_id
    where true ${req.query.includeInactive === 'true' ? noFilter() : db`and d.is_active = true`}
    order by d.name`;
  res.json({ success: true, data });
});

/** GET /api/departments/:id */
const getOne = asyncHandler(async (req, res) => {
  const [department] = await db`
    select ${db.unsafe(SELECT)}
    from departments d left join employees m on m.id = d.manager_id
    where d.id = ${req.params.id}`;
  if (!department) throw ApiError.notFound('Department not found');

  const employees = await db`
    select e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
           e.job_title as "jobTitle", e.employee_code as "employeeCode",
           e.status, e.avatar_url as "avatarUrl"
    from employees e
    where e.department_id = ${department._id} and e.deleted_at is null
    order by e.first_name`;

  res.json({ success: true, data: { ...department, employees } });
});

/** POST /api/departments — admin only. */
const create = asyncHandler(async (req, res) => {
  if (req.body.manager) {
    const [m] = await db`select id from employees where id = ${req.body.manager} and deleted_at is null`;
    if (!m) throw ApiError.badRequest('Manager does not exist');
  }

  const [row] = await db`
    insert into departments (name, code, description, manager_id, cost_center)
    values (${req.body.name}, ${req.body.code}, ${req.body.description || null},
            ${req.body.manager || null}, ${req.body.costCenter || null})
    returning id`;

  await audit.record(req, {
    action: 'department.create',
    entity: 'Department',
    entityId: row.id,
    after: { name: req.body.name, code: req.body.code },
  });

  const [department] = await db`
    select ${db.unsafe(SELECT)} from departments d left join employees m on m.id = d.manager_id
    where d.id = ${row.id}`;
  res.status(201).json({ success: true, data: department });
});

/** PATCH /api/departments/:id — admin only. */
const update = asyncHandler(async (req, res) => {
  const [existing] = await db`select * from departments where id = ${req.params.id}`;
  if (!existing) throw ApiError.notFound('Department not found');

  const COLUMN = {
    name: 'name',
    code: 'code',
    description: 'description',
    manager: 'manager_id',
    costCenter: 'cost_center',
  };
  const patch = {};
  Object.keys(req.body).forEach((f) => {
    if (COLUMN[f]) patch[COLUMN[f]] = req.body[f];
  });
  if (!Object.keys(patch).length) throw ApiError.badRequest('No fields to update');

  await db`update departments set ${db(patch)} where id = ${existing.id}`;

  await audit.record(req, {
    action: 'department.update',
    entity: 'Department',
    entityId: existing.id,
    before: { name: existing.name, code: existing.code },
    after: req.body,
  });

  const [department] = await db`
    select ${db.unsafe(SELECT)} from departments d left join employees m on m.id = d.manager_id
    where d.id = ${existing.id}`;
  res.json({ success: true, data: department });
});

/**
 * DELETE /api/departments/:id
 * Archived rather than removed, and refused while people are still assigned to it —
 * otherwise those employee records would point at nothing.
 */
const archive = asyncHandler(async (req, res) => {
  const [department] = await db`select * from departments where id = ${req.params.id}`;
  if (!department) throw ApiError.notFound('Department not found');

  const [{ count }] = await db`
    select count(*)::int from employees
    where department_id = ${department.id} and deleted_at is null`;
  if (count > 0) throw ApiError.conflict(`Reassign the ${count} employee(s) in this department first`);

  await db`update departments set is_active = false where id = ${department.id}`;
  await audit.record(req, {
    action: 'department.archive',
    entity: 'Department',
    entityId: department.id,
  });

  res.json({ success: true, message: 'Department archived' });
});

module.exports = { list, getOne, create, update, archive };
