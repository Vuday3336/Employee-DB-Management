'use strict';
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const scopeService = require('../services/scopeService');

/**
 * Layer 2: coarse role gate. "Is this *class* of user allowed on this route at all?"
 * Cheap, declarative, and always paired with a record-level check on routes that
 * address a specific person.
 */
const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden(`Requires role: ${roles.join(' or ')}`));
  }
  next();
};

/**
 * Layer 3: record-level ownership. "Is this user allowed to touch *this* record?"
 *
 * This is what stops manager A from reading manager B's team by simply typing a
 * different id in the URL — the check runs server-side against the reporting tree,
 * so hiding the link in the UI is irrelevant to it.
 */
const canAccessEmployee = (param = 'id') =>
  asyncHandler(async (req, _res, next) => {
    const employeeId = req.params[param] || req.body[param] || req.body.employee;
    if (!employeeId) throw ApiError.badRequest('Employee reference is required');
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
    req.targetEmployeeId = String(employeeId);
    next();
  });

/**
 * Field-level guard. Salary is readable by admins and by the employee themselves;
 * a manager can see their report's job data but not their pay.
 */
const SENSITIVE_FIELDS = ['salary'];

function redactEmployee(doc, user) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };
  const isSelfRecord = user.employee && String(plain._id) === String(user.employee);
  if (user.role !== 'admin' && !isSelfRecord) {
    SENSITIVE_FIELDS.forEach((field) => delete plain[field]);
  }
  // .lean() drops schema virtuals, so re-derive the one the UI depends on.
  if (plain.firstName && !plain.fullName) plain.fullName = `${plain.firstName} ${plain.lastName}`.trim();
  return plain;
}

const redactEmployees = (docs, user) => docs.map((d) => redactEmployee(d, user));

module.exports = { authorize, canAccessEmployee, redactEmployee, redactEmployees };
