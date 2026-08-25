'use strict';
const { User } = require('../models');
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
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Account is deactivated');

  req.user = {
    id: String(user._id),
    _id: user._id,
    email: user.email,
    role: user.role,
    employee: user.employee ? String(user.employee) : null,
  };
  next();
});

module.exports = { authenticate };
