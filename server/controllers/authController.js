'use strict';
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const tokens = require('../services/tokenService');

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const hash = (plain) => bcrypt.hash(plain, 12);

/** The session payload the client expects — unchanged from the Mongo implementation. */
const publicUser = (user, employee) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  employeeId: user.employee_id || null,
  isActive: user.is_active,
  lastLoginAt: user.last_login_at,
  employee: employee
    ? {
        id: employee.id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        fullName: `${employee.first_name} ${employee.last_name}`,
        jobTitle: employee.job_title,
        department: employee.department_id,
        avatarUrl: employee.avatar_url,
      }
    : null,
});

const findEmployee = async (id) =>
  id ? (await db`select * from employees where id = ${id}`)[0] || null : null;

async function issueSession(res, user) {
  const principal = { _id: user.id, role: user.role, employee: user.employee_id, email: user.email };
  const accessToken = tokens.signAccessToken(principal);
  tokens.setRefreshCookie(res, tokens.signRefreshToken({ ...principal, tokenVersion: user.token_version }));
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

  const [exists] = await db`select id from users where email = ${email}`;
  if (exists) throw ApiError.conflict('An account with that email already exists');

  // Link to a pre-created HR record when the work email matches.
  const [employee] = await db`
    select * from employees where work_email = ${email} and deleted_at is null`;

  const [user] = await db`
    insert into users (email, password_hash, role, employee_id)
    values (${email}, ${await hash(password)}, 'employee', ${employee?.id || null})
    returning *`;

  await audit.record(req, { action: 'auth.register', entity: 'User', entityId: user.id, actor: user });

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

  const [user] = await db`select * from users where email = ${email}`;
  if (!user) throw ApiError.unauthorized('Invalid email or password');

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw ApiError.forbidden('Account temporarily locked after too many failed attempts');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    const attempts = user.failed_login_attempts + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await db`
      update users set
        failed_login_attempts = ${lock ? 0 : attempts},
        locked_until = ${lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null}
      where id = ${user.id}`;

    await audit.record(req, {
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      outcome: 'denied',
      actor: user,
    });
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.is_active) throw ApiError.forbidden('Account is deactivated');

  const [fresh] = await db`
    update users set failed_login_attempts = 0, locked_until = null, last_login_at = now()
    where id = ${user.id} returning *`;

  const employee = await findEmployee(fresh.employee_id);
  const accessToken = await issueSession(res, fresh);

  await audit.record(req, { action: 'auth.login', entity: 'User', entityId: fresh.id, actor: fresh });
  res.json({ success: true, data: { accessToken, user: publicUser(fresh, employee) } });
});

/**
 * POST /api/auth/refresh
 * Rotates the refresh cookie and re-checks token_version, so a token issued before
 * a logout, password change or role change is rejected even though its signature
 * is still valid.
 */
const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[tokens.REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session');

  const payload = tokens.verifyRefreshToken(token);
  const [user] = await db`select * from users where id = ${payload.sub}::uuid`;
  if (!user || !user.is_active) throw ApiError.unauthorized('Session is no longer valid');
  if (payload.tv !== user.token_version) {
    throw ApiError.unauthorized('Session was revoked, please sign in again');
  }

  const accessToken = await issueSession(res, user);
  const employee = await findEmployee(user.employee_id);
  res.json({ success: true, data: { accessToken, user: publicUser(user, employee) } });
});

/** POST /api/auth/logout — bumps token_version so every outstanding refresh token dies. */
const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[tokens.REFRESH_COOKIE];
  if (token) {
    try {
      const payload = tokens.verifyRefreshToken(token);
      await db`update users set token_version = token_version + 1 where id = ${payload.sub}::uuid`;
    } catch {
      /* already invalid — clearing the cookie is enough */
    }
  }
  tokens.clearRefreshCookie(res);
  res.json({ success: true, message: 'Signed out' });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const [user] = await db`select * from users where id = ${req.user.id}::uuid`;
  if (!user) throw ApiError.unauthorized();
  const employee = await findEmployee(user.employee_id);
  res.json({ success: true, data: publicUser(user, employee) });
});

/** PATCH /api/auth/password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const [user] = await db`select * from users where id = ${req.user.id}::uuid`;
  if (!user) throw ApiError.unauthorized();

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  // Bumping token_version here is what actually revokes the other sessions.
  await db`
    update users set password_hash = ${await hash(newPassword)}, token_version = token_version + 1
    where id = ${user.id}`;
  tokens.clearRefreshCookie(res);

  await audit.record(req, {
    action: 'auth.password_change',
    entity: 'User',
    entityId: user.id,
    actor: user,
  });
  res.json({ success: true, message: 'Password updated. Please sign in again.' });
});

module.exports = { register, login, refresh, logout, me, changePassword, hash, publicUser };
