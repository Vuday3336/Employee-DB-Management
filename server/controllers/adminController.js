'use strict';
const { db, noFilter } = require('../db');
const { USER_COLS } = require('../db/shapes');
const { ROLES } = require('../db/enums');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const { hash } = require('./authController');
const { parsePagination, buildMeta } = require('../utils/query');
const { dayjs } = require('../utils/dates');

/* ------------------------------- users ---------------------------------- */

const USER_SELECT = `
  ${USER_COLS},
  case when e.id is null then null else
    json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                      'employeeCode', e.employee_code, 'jobTitle', e.job_title) end as "employee"
`;

/** GET /api/users — admin only. */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where = db`
    where true
      ${req.query.role ? db`and u.role = ${req.query.role}` : noFilter()}
      ${req.query.q ? db`and u.email ilike ${'%' + req.query.q + '%'}` : noFilter()}`;

  const [items, [{ count }]] = await Promise.all([
    db`select ${db.unsafe(USER_SELECT)} from users u left join employees e on e.id = u.employee_id
       ${where} order by u.created_at desc limit ${limit} offset ${skip}`,
    db`select count(*)::int from users u ${where}`,
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total: count }) });
});

/** POST /api/users — the only path that can mint a manager or admin account. */
const createUser = asyncHandler(async (req, res) => {
  const { email, password, role, employee } = req.body;

  const [exists] = await db`select id from users where email = ${email}`;
  if (exists) throw ApiError.conflict('An account with that email already exists');

  if (employee) {
    const [record] = await db`select id from employees where id = ${employee}`;
    if (!record) throw ApiError.badRequest('Employee record does not exist');
    const [linked] = await db`select id from users where employee_id = ${employee}`;
    if (linked) throw ApiError.conflict('That employee already has a login account');
  }

  const [row] = await db`
    insert into users (email, password_hash, role, employee_id)
    values (${email}, ${await hash(password)}, ${role}, ${employee || null})
    returning ${db.unsafe(USER_COLS.replace(/u\./g, ''))}`;

  await audit.record(req, {
    action: 'user.create',
    entity: 'User',
    entityId: row._id,
    after: { email, role, employee: employee || null },
  });

  res.status(201).json({ success: true, data: row });
});

/**
 * PATCH /api/users/:id/role
 * A role change bumps token_version, so the affected session loses its elevated
 * access on the next refresh rather than at token expiry.
 */
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!ROLES.includes(role)) throw ApiError.badRequest('Unknown role');

  const [user] = await db`select * from users where id = ${req.params.id}`;
  if (!user) throw ApiError.notFound('User not found');
  if (String(user.id) === String(req.user.id)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  await db`update users set role = ${role}, token_version = token_version + 1 where id = ${user.id}`;

  await audit.record(req, {
    action: 'user.role_change',
    entity: 'User',
    entityId: user.id,
    before: { role: user.role },
    after: { role },
  });

  const [updated] = await db`select ${db.unsafe(USER_COLS)} from users u where u.id = ${user.id}`;
  res.json({ success: true, data: updated });
});

/** PATCH /api/users/:id/status — enable or disable a login. */
const setUserStatus = asyncHandler(async (req, res) => {
  const isActive = Boolean(req.body.isActive);
  const [user] = await db`select * from users where id = ${req.params.id}`;
  if (!user) throw ApiError.notFound('User not found');
  if (String(user.id) === String(req.user.id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  await db`
    update users set
      is_active = ${isActive},
      token_version = token_version + ${isActive ? 0 : 1},
      locked_until = null,
      failed_login_attempts = 0
    where id = ${user.id}`;

  await audit.record(req, {
    action: isActive ? 'user.activate' : 'user.deactivate',
    entity: 'User',
    entityId: user.id,
  });

  const [updated] = await db`select ${db.unsafe(USER_COLS)} from users u where u.id = ${user.id}`;
  res.json({ success: true, data: updated });
});

/* ----------------------------- audit trail ------------------------------- */

/** GET /api/audit — admin only, read-only view of the append-only trail. */
const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const where = db`
    where true
      ${req.query.entity ? db`and entity = ${req.query.entity}` : noFilter()}
      ${req.query.action ? db`and action like ${req.query.action + '%'}` : noFilter()}
      ${req.query.actor ? db`and actor_id = ${req.query.actor}` : noFilter()}
      ${req.query.outcome ? db`and outcome = ${req.query.outcome}` : noFilter()}`;

  const [items, [{ count }]] = await Promise.all([
    db`select id as "_id", actor_email as "actorEmail", actor_role as "actorRole",
              action, entity, entity_id as "entityId", changes, outcome, created_at as "createdAt"
       from audit_logs ${where} order by created_at desc limit ${limit} offset ${skip}`,
    db`select count(*)::int from audit_logs ${where}`,
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total: count }) });
});

/* ---------------------------- leave policies ----------------------------- */

const POLICY_SELECT = `
  type, label, annual_quota::float8 as "annualQuota", accrues,
  max_carry_forward::float8 as "maxCarryForward", max_consecutive_days as "maxConsecutiveDays",
  min_notice_days as "minNoticeDays", requires_attachment as "requiresAttachment",
  is_paid as "isPaid", is_active as "isActive"
`;

const listPolicies = asyncHandler(async (_req, res) => {
  const data = await db`select ${db.unsafe(POLICY_SELECT)} from leave_policies order by label`;
  // The client keys policies by `_id` in a few places; `type` is the natural key here.
  res.json({ success: true, data: data.map((p) => ({ ...p, _id: p.type })) });
});

const upsertPolicy = asyncHandler(async (req, res) => {
  const b = req.body;
  const [before] = await db`select ${db.unsafe(POLICY_SELECT)} from leave_policies where type = ${b.type}`;

  await db`
    insert into leave_policies (type, label, annual_quota, accrues, max_carry_forward,
                                max_consecutive_days, min_notice_days, requires_attachment, is_paid, is_active)
    values (${b.type}, ${b.label}, ${b.annualQuota}, ${b.accrues ?? true}, ${b.maxCarryForward ?? 0},
            ${b.maxConsecutiveDays ?? 30}, ${b.minNoticeDays ?? 0}, ${b.requiresAttachment ?? false},
            ${b.isPaid ?? true}, ${b.isActive ?? true})
    on conflict (type) do update set
      label = excluded.label, annual_quota = excluded.annual_quota, accrues = excluded.accrues,
      max_carry_forward = excluded.max_carry_forward, max_consecutive_days = excluded.max_consecutive_days,
      min_notice_days = excluded.min_notice_days, requires_attachment = excluded.requires_attachment,
      is_paid = excluded.is_paid, is_active = excluded.is_active`;

  const [after] = await db`select ${db.unsafe(POLICY_SELECT)} from leave_policies where type = ${b.type}`;
  await audit.record(req, { action: 'policy.upsert', entity: 'LeavePolicy', before, after });

  res.json({ success: true, data: { ...after, _id: after.type } });
});

/* ------------------------------ holidays -------------------------------- */

const listHolidays = asyncHandler(async (req, res) => {
  const year = req.query.year;
  const data = await db`
    select id as "_id", name, date, region, is_optional as "isOptional"
    from holidays
    where true ${year ? db`and extract(year from date) = ${Number(year)}` : noFilter()}
    order by date`;
  res.json({ success: true, data });
});

const createHoliday = asyncHandler(async (req, res) => {
  const [row] = await db`
    insert into holidays (name, date, region, is_optional)
    values (${req.body.name}, ${dayjs.utc(req.body.date).format('YYYY-MM-DD')},
            ${req.body.region || 'ALL'}, ${req.body.isOptional ?? false})
    returning id as "_id", name, date, region, is_optional as "isOptional"`;

  await audit.record(req, { action: 'holiday.create', entity: 'Holiday', entityId: row._id });
  res.status(201).json({ success: true, data: row });
});

const deleteHoliday = asyncHandler(async (req, res) => {
  const [row] = await db`delete from holidays where id = ${req.params.id} returning id`;
  if (!row) throw ApiError.notFound('Holiday not found');
  await audit.record(req, { action: 'holiday.delete', entity: 'Holiday', entityId: row.id });
  res.json({ success: true, message: 'Holiday removed' });
});

/* ---------------------------- notifications ------------------------------ */

const listNotifications = asyncHandler(async (req, res) => {
  const [items, [{ unread }]] = await Promise.all([
    db`select id as "_id", type, title, message, link, read_at as "readAt", created_at as "createdAt"
       from notifications
       where user_id = ${req.user.id} ${req.query.unread === 'true' ? db`and read_at is null` : noFilter()}
       order by created_at desc limit 50`,
    db`select count(*)::int as unread from notifications where user_id = ${req.user.id} and read_at is null`,
  ]);
  res.json({ success: true, data: items, meta: { unread } });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const [row] = await db`
    update notifications set read_at = now()
    where id = ${req.params.id} and user_id = ${req.user.id} returning id`;
  if (!row) throw ApiError.notFound('Notification not found');
  res.json({ success: true, message: 'Marked as read' });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await db`update notifications set read_at = now() where user_id = ${req.user.id} and read_at is null`;
  res.json({ success: true, message: 'All notifications marked as read' });
});

module.exports = {
  listUsers,
  createUser,
  updateUserRole,
  setUserStatus,
  listAudit,
  listPolicies,
  upsertPolicy,
  listHolidays,
  createHoliday,
  deleteHoliday,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};
