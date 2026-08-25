'use strict';
const { User, Employee } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const tokens = require('../services/tokenService');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const publicUser = (user, employee) => ({
  id: user._id,
  email: user.email,
  role: user.role,
  employeeId: user.employee || null,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
  employee: employee
    ? {
        id: employee._id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        fullName: `${employee.firstName} ${employee.lastName}`,
        jobTitle: employee.jobTitle,
        department: employee.department,
        avatarUrl: employee.avatarUrl,
      }
    : null,
});

async function issueSession(res, user) {
  const accessToken = tokens.signAccessToken(user);
  const refreshToken = tokens.signRefreshToken(user);
  tokens.setRefreshCookie(res, refreshToken);
  return accessToken;
}

/**
 * POST /api/auth/register
 * Self-registration only ever creates an `employee` account. Elevated roles are
 * assigned by an admin through POST /api/users, never by the caller's own request
 * body — otherwise anyone could sign up as an admin.
 */
const register = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) throw ApiError.conflict('An account with that email already exists');

  // Link to a pre-created HR record when the work email matches.
  const employee = await Employee.findOne({ workEmail: email, deletedAt: null }).lean();

  const user = new User({ email, role: 'employee', employee: employee?._id });
  await user.setPassword(password);
  await user.save();

  await audit.record(req, {
    action: 'auth.register',
    entity: 'User',
    entityId: user._id,
    actor: user,
  });

  const accessToken = await issueSession(res, user);
  res.status(201).json({ success: true, data: { accessToken, user: publicUser(user, employee) } });
});

/**
 * POST /api/auth/login
 * Failed attempts are counted and the account locks for 15 minutes after five,
 * which blunts credential stuffing even behind a rotating IP pool.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Invalid email or password');

  if (user.isLocked) {
    throw ApiError.forbidden('Account temporarily locked after too many failed attempts');
  }

  const ok = await user.verifyPassword(password);
  if (!ok) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    await audit.record(req, {
      action: 'auth.login',
      entity: 'User',
      entityId: user._id,
      outcome: 'denied',
      actor: user,
    });
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) throw ApiError.forbidden('Account is deactivated');

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const employee = user.employee ? await Employee.findById(user.employee).lean() : null;
  const accessToken = await issueSession(res, user);

  await audit.record(req, { action: 'auth.login', entity: 'User', entityId: user._id, actor: user });
  res.json({ success: true, data: { accessToken, user: publicUser(user, employee) } });
});

/**
 * POST /api/auth/refresh
 * Rotates the refresh cookie and re-checks tokenVersion, so a token issued before
 * a logout or password change is rejected even though its signature is still valid.
 */
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[tokens.REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session');

  const payload = tokens.verifyRefreshToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Session is no longer valid');
  if (payload.tv !== user.tokenVersion) {
    throw ApiError.unauthorized('Session was revoked, please sign in again');
  }

  const accessToken = await issueSession(res, user);
  const employee = user.employee ? await Employee.findById(user.employee).lean() : null;
  res.json({ success: true, data: { accessToken, user: publicUser(user, employee) } });
});

/** POST /api/auth/logout — bumps tokenVersion so every outstanding refresh token dies. */
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[tokens.REFRESH_COOKIE];
  if (token) {
    try {
      const payload = tokens.verifyRefreshToken(token);
      await User.findByIdAndUpdate(payload.sub, { $inc: { tokenVersion: 1 } });
    } catch {
      /* already invalid — clearing the cookie is enough */
    }
  }
  tokens.clearRefreshCookie(res);
  res.json({ success: true, message: 'Signed out' });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) throw ApiError.unauthorized();
  const employee = user.employee
    ? await Employee.findById(user.employee).populate('department', 'name code').lean()
    : null;
  res.json({ success: true, data: publicUser(user, employee) });
});

/** PATCH /api/auth/password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw ApiError.unauthorized();

  const ok = await user.verifyPassword(currentPassword);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  await user.setPassword(newPassword); // also bumps tokenVersion
  await user.save();
  tokens.clearRefreshCookie(res);

  await audit.record(req, {
    action: 'auth.password_change',
    entity: 'User',
    entityId: user._id,
    actor: user,
  });
  res.json({ success: true, message: 'Password updated. Please sign in again.' });
});

module.exports = { register, login, refresh, logout, me, changePassword };
