'use strict';
const { Notification, User } = require('../models');
const { emitToUser } = require('./realtime');
const logger = require('../utils/logger');

/** Persist a notification and push it down the recipient's socket room. */
async function notifyUser(userId, { type, title, message, link }) {
  if (!userId) return null;
  const doc = await Notification.create({ user: userId, type, title, message, link });
  emitToUser(String(userId), 'notification', doc.toJSON());
  return doc;
}

/** Resolve the login account attached to an employee record, if any. */
async function userForEmployee(employeeId) {
  if (!employeeId) return null;
  return User.findOne({ employee: employeeId, isActive: true }).select('_id').lean();
}

async function notifyEmployee(employeeId, payload) {
  try {
    const user = await userForEmployee(employeeId);
    if (!user) return null;
    return notifyUser(user._id, payload);
  } catch (err) {
    logger.error('notifyEmployee failed', err.message);
    return null;
  }
}

module.exports = { notifyEmployee };
