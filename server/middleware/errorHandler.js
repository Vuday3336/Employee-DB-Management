'use strict';
const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const logger = require('../utils/logger');

const notFound = (req, _res, next) =>
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));

/** Turn a Postgres constraint name into something an HR user can act on. */
const CONSTRAINT_MESSAGES = {
  employees_work_email_key: 'An employee with that work email already exists',
  employees_employee_code_key: 'That employee code is already in use',
  users_email_key: 'An account with that email already exists',
  users_employee_id_key: 'That employee already has a login account',
  departments_name_key: 'A department with that name already exists',
  departments_code_key: 'A department with that code already exists',
  attendance_employee_id_date_key: 'An attendance record already exists for that day',
  performance_reviews_employee_id_period_year_period_quarter_key:
    'A review already exists for that employee and period',
  leave_balances_employee_id_type_key: 'That leave balance already exists',
  holidays_date_key: 'A holiday is already recorded on that date',
  employee_not_own_manager: 'An employee cannot report to themselves',
  review_not_self: 'An employee cannot review themselves',
  leave_dates_ordered: 'The end date cannot be before the start date',
  attendance_checkout_after_checkin: 'Check-out must be after check-in',
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof ZodError) {
    statusCode = 422;
    message = 'Validation failed';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err.code === '23505') {
    // unique_violation
    statusCode = 409;
    message = CONSTRAINT_MESSAGES[err.constraint_name] || 'That record already exists';
  } else if (err.code === '23514') {
    // check_violation — a business rule encoded in the schema
    statusCode = 400;
    message = CONSTRAINT_MESSAGES[err.constraint_name] || 'That change breaks a database constraint';
  } else if (err.code === '23503') {
    // foreign_key_violation
    statusCode = 400;
    message = 'That references a record which does not exist';
  } else if (err.code === '22P02' || err.code === '22007') {
    // invalid input syntax for uuid / enum / date
    statusCode = 400;
    message = 'A value in the request has the wrong format';
  } else if (err.code === '23502') {
    // not_null_violation
    statusCode = 422;
    message = `${err.column_name || 'A required field'} is required`;
  }

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, err.stack || err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    requestId: req.id,
    ...(env.isProd ? {} : { stack: err.stack }),
  });
}

module.exports = { notFound, errorHandler };
