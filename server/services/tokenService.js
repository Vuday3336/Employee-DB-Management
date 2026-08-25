'use strict';
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const REFRESH_COOKIE = 'empcore_rt';

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      employee: user.employee ? user.employee.toString() : null,
      email: user.email,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'empcore' }
  );
}

/**
 * Refresh tokens carry the user's tokenVersion. Logging out or changing a password
 * bumps that counter, which invalidates every refresh token already in the wild.
 */
function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), tv: user.tokenVersion },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_TTL, issuer: 'empcore' }
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'empcore' });
  } catch (err) {
    throw err.name === 'TokenExpiredError'
      ? ApiError.unauthorized('Access token expired')
      : ApiError.unauthorized('Invalid access token');
  }
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: 'empcore' });
  } catch {
    throw ApiError.unauthorized('Invalid or expired session, please sign in again');
  }
}

/**
 * Cookie options.
 *
 * A split deploy (client on one domain, API on another) is cross-site as far as
 * the browser is concerned, so the refresh cookie needs SameSite=None — anything
 * stricter is silently dropped and every session dies on reload. SameSite=None
 * is only honoured alongside Secure, which is why the two move together.
 *
 * If you serve both halves from one domain, set COOKIE_SAMESITE=lax to get CSRF
 * protection back.
 */
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
});

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  // Must match the attributes the cookie was set with, or the browser keeps it.
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

module.exports = {
  REFRESH_COOKIE,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
};
