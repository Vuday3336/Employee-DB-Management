'use strict';
const { db } = require('../db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../services/tokenService');

/**
 * Layer 1 of the authorization chain: proves *who* the caller is.
 *
 * The JWT payload is not trusted on its own — the user is re-read on every request
 * so that a deactivated account or a role that was changed mid-session takes effect
 * immediately instead of at token expiry.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  const payload = verifyAccessToken(token);
  const [user] = await db`
    select id, email, role, employee_id, is_active from users where id = ${payload.sub}::uuid`;
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (!user.is_active) throw ApiError.forbidden('Account is deactivated');

  req.user = {
    id: String(user.id),
    _id: user.id,
    email: user.email,
    role: user.role,
    employee: user.employee_id ? String(user.employee_id) : null,
  };
  next();
});

module.exports = { authenticate };
