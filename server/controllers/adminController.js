'use strict';
const { User, AuditLog, LeavePolicy, Holiday, Notification, Employee } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const { parsePagination, buildMeta, escapeRegex } = require('../utils/query');
const { startOfDay } = require('../utils/dates');

/* ------------------------------- users ---------------------------------- */

/** GET /api/users — admin only. */
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.q) filter.email = new RegExp(escapeRegex(req.query.q), 'i');

  const [items, total] = await Promise.all([
    User.find(filter)
      .populate('employee', 'firstName lastName employeeCode jobTitle')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total }) });
});

/** POST /api/users — the only path that can mint a manager or admin account. */
const createUser = asyncHandler(async (req, res) => {
  const { email, password, role, employee } = req.body;

  if (await User.findOne({ email })) throw ApiError.conflict('An account with that email already exists');
  if (employee) {
    const record = await Employee.findById(employee).lean();
    if (!record) throw ApiError.badRequest('Employee record does not exist');
    if (await User.findOne({ employee })) {
      throw ApiError.conflict('That employee already has a login account');
    }
  }

  const user = new User({ email, role, employee });
  await user.setPassword(password);
  await user.save();

  await audit.record(req, {
    action: 'user.create',
    entity: 'User',
    entityId: user._id,
    after: { email, role, employee },
  });

  res.status(201).json({ success: true, data: user.toJSON() });
});

/**
 * PATCH /api/users/:id/role
 * A role change bumps tokenVersion, so the affected session loses its elevated
 * access on the next refresh rather than at token expiry.
 */
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!User.ROLES.includes(role)) throw ApiError.badRequest('Unknown role');

  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user.id)) {
    throw ApiError.badRequest('You cannot change your own role');
  }

  const before = { role: user.role };
  user.role = role;
  user.tokenVersion += 1;
  await user.save();

  await audit.record(req, {
    action: 'user.role_change',
    entity: 'User',
    entityId: user._id,
    before,
    after: { role },
  });

  res.json({ success: true, data: user.toJSON() });
});

/** PATCH /api/users/:id/status — enable or disable a login. */
const setUserStatus = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (String(user._id) === String(req.user.id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }

  user.isActive = Boolean(isActive);
  if (!user.isActive) user.tokenVersion += 1; // kill live sessions immediately
  user.lockedUntil = undefined;
  user.failedLoginAttempts = 0;
  await user.save();

  await audit.record(req, {
    action: user.isActive ? 'user.activate' : 'user.deactivate',
    entity: 'User',
    entityId: user._id,
  });

  res.json({ success: true, data: user.toJSON() });
});

/* ----------------------------- audit trail ------------------------------- */

/** GET /api/audit — admin only, read-only view of the append-only trail. */
const listAudit = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.entity) filter.entity = req.query.entity;
  if (req.query.action) filter.action = new RegExp(`^${escapeRegex(req.query.action)}`);
  if (req.query.actor) filter.actor = req.query.actor;
  if (req.query.outcome) filter.outcome = req.query.outcome;

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total }) });
});

/* ---------------------------- leave policies ----------------------------- */

const listPolicies = asyncHandler(async (_req, res) => {
  const data = await LeavePolicy.find({}).sort({ label: 1 }).lean();
  res.json({ success: true, data });
});

const upsertPolicy = asyncHandler(async (req, res) => {
  const before = await LeavePolicy.findOne({ type: req.body.type }).lean();
  const policy = await LeavePolicy.findOneAndUpdate({ type: req.body.type }, req.body, {
    upsert: true,
    new: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });

  await audit.record(req, {
    action: 'policy.upsert',
    entity: 'LeavePolicy',
    entityId: policy._id,
    before,
    after: policy.toObject(),
  });
  res.json({ success: true, data: policy });
});

/* ------------------------------ holidays -------------------------------- */

const listHolidays = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.year) {
    filter.date = {
      $gte: new Date(`${req.query.year}-01-01T00:00:00.000Z`),
      $lte: new Date(`${req.query.year}-12-31T23:59:59.999Z`),
    };
  }
  const data = await Holiday.find(filter).sort({ date: 1 }).lean();
  res.json({ success: true, data });
});

const createHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.create({ ...req.body, date: startOfDay(req.body.date) });
  await audit.record(req, { action: 'holiday.create', entity: 'Holiday', entityId: holiday._id });
  res.status(201).json({ success: true, data: holiday });
});

const deleteHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) throw ApiError.notFound('Holiday not found');
  await audit.record(req, { action: 'holiday.delete', entity: 'Holiday', entityId: holiday._id });
  res.json({ success: true, message: 'Holiday removed' });
});

/* ---------------------------- notifications ------------------------------ */

const listNotifications = asyncHandler(async (req, res) => {
  const filter = { user: req.user.id };
  if (req.query.unread === 'true') filter.readAt = null;

  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ user: req.user.id, readAt: null }),
  ]);

  res.json({ success: true, data: items, meta: { unread } });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateOne(
    { _id: req.params.id, user: req.user.id },
    { readAt: new Date() }
  );
  if (!result.matchedCount) throw ApiError.notFound('Notification not found');
  res.json({ success: true, message: 'Marked as read' });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user.id, readAt: null }, { readAt: new Date() });
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
