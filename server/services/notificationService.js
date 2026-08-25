'use strict';
const { db } = require('../db');
const { emitToUser } = require('./realtime');
const logger = require('../utils/logger');

/** Persist a notification and push it down the recipient's socket room. */
async function notifyUser(userId, { type, title, message, link }) {
  if (!userId) return null;
  const [row] = await db`
    insert into notifications (user_id, type, title, message, link)
    values (${userId}, ${type}, ${title}, ${message}, ${link || null})
    returning id as "_id", type, title, message, link, read_at as "readAt", created_at as "createdAt"`;
  emitToUser(String(userId), 'notification', row);
  return row;
}

/**
 * Resolve the login account attached to an employee record. Not every employee has
 * one (contractors, people not yet onboarded), so a missing account is normal and
 * simply means there is nobody to notify.
 */
async function notifyEmployee(employeeId, payload) {
  if (!employeeId) return null;
  try {
    const [user] = await db`
      select id from users where employee_id = ${employeeId} and is_active = true limit 1`;
    if (!user) return null;
    return await notifyUser(user.id, payload);
  } catch (err) {
    logger.error('notifyEmployee failed:', err.message);
    return null;
  }
}

module.exports = { notifyEmployee, notifyUser };
